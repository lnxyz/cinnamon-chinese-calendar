// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const St = imports.gi.St;
const Signals = imports.signals;
const Pango = imports.gi.Pango;
const Gettext_gtk30 = imports.gettext.domain("gtk30");
const Cinnamon = imports.gi.Cinnamon;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;

// ★ Lunar support
const { Solar, Lunar, I18n } = require("./lunar");

const MSECS_IN_DAY = 24 * 60 * 60 * 1000;
const WEEKDATE_HEADER_WIDTH_DIGITS = 3;
const SHOW_WEEKDATE_KEY = "show-week-numbers";
const FIRST_WEEKDAY_KEY = "first-day-of-week";
const DESKTOP_SCHEMA = "org.cinnamon.desktop.interface";
const CLOCK_FORMAT_KEY = "clock-format";

function _sameDay(dateA, dateB) {
    return (
        dateA.getDate() == dateB.getDate() &&
        dateA.getMonth() == dateB.getMonth() &&
        dateA.getYear() == dateB.getYear()
    );
}

function _today(date) {
    let today = new Date();
    return (
        date.getDate() == today.getDate() &&
        date.getMonth() == today.getMonth() &&
        date.getYear() == today.getYear()
    );
}

function _sameYear(dateA, dateB) {
    return dateA.getYear() == dateB.getYear();
}

function _isWorkDay(date) {
    return date.getDay() != 0 && date.getDay() != 6;
}

function _getBeginningOfDay(date) {
    let ret = new Date(date.getTime());
    ret.setHours(0);
    ret.setMinutes(0);
    ret.setSeconds(0);
    ret.setMilliseconds(0);
    return ret;
}

function _getEndOfDay(date) {
    let ret = new Date(date.getTime());
    ret.setHours(23);
    ret.setMinutes(59);
    ret.setSeconds(59);
    ret.setMilliseconds(999);
    return ret;
}

function _formatEventTime(event, clockFormat) {
    let ret;
    if (event.allDay) {
        ret = C_("event list time", "All Day");
    } else {
        switch (clockFormat) {
            case "24h":
                ret = event.date.toLocaleFormat(C_("event list time", "%H:%M"));
                break;
            default:
            case "12h":
                ret = event.date.toLocaleFormat(
                    C_("event list time", "%l:%M %p"),
                );
                break;
        }
    }
    return ret;
}

function _getDigitWidth(actor) {
    let context = actor.get_pango_context();
    let themeNode = actor.get_theme_node();
    let font = themeNode.get_font();
    let metrics = context.get_metrics(font, context.get_language());
    let width = metrics.get_approximate_digit_width();
    return width;
}

function _getCalendarDayAbbreviation(dayNumber) {
    let abbreviations = [
        new Date(2014, 2, 2).toLocaleFormat("%a"),
        new Date(2014, 2, 3).toLocaleFormat("%a"),
        new Date(2014, 2, 4).toLocaleFormat("%a"),
        new Date(2014, 2, 5).toLocaleFormat("%a"),
        new Date(2014, 2, 6).toLocaleFormat("%a"),
        new Date(2014, 2, 7).toLocaleFormat("%a"),
        new Date(2014, 2, 8).toLocaleFormat("%a"),
    ];
    return abbreviations[dayNumber];
}

class CalendarEvent {
    constructor(date, end, summary, allDay) {
        this.date = date;
        this.end = end;
        this.summary = summary;
        this.allDay = allDay;
    }
}

function _datesEqual(a, b) {
    if (a < b) return false;
    else if (a > b) return false;
    return true;
}

function _dateIntervalsOverlap(a0, a1, b0, b1) {
    if (a1 <= b0) return false;
    else if (b1 <= a0) return false;
    else return true;
}

var Calendar = class Calendar {
    constructor(settings, events_manager) {
        this.events_manager = events_manager;
        this._weekStart = Cinnamon.util_get_week_start();
        this._weekdate = NaN;
        this._digitWidth = NaN;
        this.settings = settings;

        this._update_id = 0;
        this._set_date_idle_id = 0;

        // 设置绑定
        this.settings.bindWithObject(
            this,
            "show-week-numbers",
            "show_week_numbers",
            this._onSettingsChange,
        );

        this.desktop_settings = new Gio.Settings({ schema_id: DESKTOP_SCHEMA });
        this.desktop_settings.connect(
            "changed::" + FIRST_WEEKDAY_KEY,
            Lang.bind(this, this._onSettingsChange),
        );

        // ★ 农历显示开关
        this.show_lunar = false;
        this.settings.bindWithObject(
            this,
            "show-lunar",
            "show_lunar",
            this._onSettingsChange.bind(this),
        );

        // 事件管理
        this.events_enabled = false;
        this.events_manager.connect(
            "events-updated",
            this._events_updated.bind(this),
        );
        this.events_manager.connect(
            "events-manager-ready",
            this._update_events_enabled.bind(this),
        );
        this.events_manager.connect(
            "has-calendars-changed",
            this._update_events_enabled.bind(this),
        );

        // 月份/年份顺序
        let var_name = "calendar:MY";
        switch (Gettext_gtk30.gettext(var_name)) {
            case "calendar:MY":
                this._headerMonthFirst = true;
                break;
            case "calendar:YM":
                this._headerMonthFirst = false;
                break;
            default:
                log('Translation of "calendar:MY" in GTK+ is not correct');
                this._headerMonthFirst = true;
                break;
        }

        // 默认选中今天
        this._selectedDate = new Date();

        // 主容器
        this.actor = new St.Table({
            homogeneous: false,
            style_class: "calendar",
            reactive: true,
        });

        this.actor.connect("scroll-event", Lang.bind(this, this._onScroll));

        // 构建顶部（月份栏 + 年份栏 + 星期栏）
        this._buildHeader();

        // ★★★ 农历头部（显示在“星期三 / 日期”下面） ★★★
        this._lunarDateBox = new St.BoxLayout({
            vertical: false,
            style_class: "calendar-lunar-header-box",
        });

        this._lunarHeaderLabel = new St.Label({
            style_class: "calendar-lunar-header-label",
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._lunarDateBox.add(this._lunarHeaderLabel);
    }

    setEventsSection(section) {
        if (this._eventsSection === section) return;
        if (this._eventsSection && this._lunarDateBox.get_parent()) {
            this._eventsSection.remove_child(this._lunarDateBox);
        }
        this._eventsSection = section;
        if (this._eventsSection && this._lunarDateBox) {
            this._eventsSection.add_child(this._lunarDateBox);
        }
    }
    _buildHeader() {
        let offsetCols = this.show_week_numbers ? 1 : 0;
        this.actor.destroy_all_children();

        // 顶部：月份栏与年份栏
        this._topBoxMonth = new St.BoxLayout();
        this._topBoxYear = new St.BoxLayout();

        if (this._headerMonthFirst) {
            this.actor.add(this._topBoxMonth, {
                row: 0,
                col: 0,
                col_span: offsetCols + 4,
            });
            this.actor.add(this._topBoxYear, {
                row: 0,
                col: offsetCols + 4,
                col_span: 3,
            });
        } else {
            this.actor.add(this._topBoxMonth, {
                row: 0,
                col: offsetCols + 3,
                col_span: 4,
            });
            this.actor.add(this._topBoxYear, {
                row: 0,
                col: 0,
                col_span: offsetCols + 3,
            });
        }

        this.actor.connect(
            "style-changed",
            Lang.bind(this, this._onStyleChange),
        );

        // 月份切换按钮
        let back = new St.Button({ style_class: "calendar-change-month-back" });
        this._topBoxMonth.add(back);
        back.connect(
            "clicked",
            Lang.bind(this, this._onPrevMonthButtonClicked),
        );

        this._monthLabel = new St.Label({
            style_class: "calendar-month-label",
        });
        this._topBoxMonth.add(this._monthLabel, {
            expand: true,
            x_fill: false,
            x_align: St.Align.MIDDLE,
        });

        let forward = new St.Button({
            style_class: "calendar-change-month-forward",
        });
        this._topBoxMonth.add(forward);
        forward.connect(
            "clicked",
            Lang.bind(this, this._onNextMonthButtonClicked),
        );

        // 年份切换按钮
        back = new St.Button({ style_class: "calendar-change-month-back" });
        this._topBoxYear.add(back);
        back.connect("clicked", Lang.bind(this, this._onPrevYearButtonClicked));

        this._yearLabel = new St.Label({
            style_class: "calendar-month-label",
        });
        this._topBoxYear.add(this._yearLabel, {
            expand: true,
            x_fill: false,
            x_align: St.Align.MIDDLE,
        });

        forward = new St.Button({
            style_class: "calendar-change-month-forward",
        });
        this._topBoxYear.add(forward);
        forward.connect(
            "clicked",
            Lang.bind(this, this._onNextYearButtonClicked),
        );

        // 星期栏（row = 1）
        let iter = new Date(this._selectedDate);
        iter.setSeconds(0);
        iter.setHours(12);

        for (let i = 0; i < 7; i++) {
            let styleClass = "calendar-day-base calendar-day-heading";
            if (_isWorkDay(iter)) styleClass += " calendar-work-day";
            else styleClass += " calendar-nonwork-day";

            let customDayAbbrev = _getCalendarDayAbbreviation(iter.getDay());
            let label = new St.Label({
                style_class: styleClass,
                text: customDayAbbrev,
            });

            this.actor.add(label, {
                row: 1,
                col: offsetCols + ((7 + iter.getDay() - this._weekStart) % 7),
                x_fill: false,
                x_align: St.Align.MIDDLE,
            });

            iter.setTime(iter.getTime() + MSECS_IN_DAY);
        }

        // 日历格子从这里开始
        this._firstDayIndex = this.actor.get_n_children();
    }

    _update(forceReload) {
        let now = new Date();

        // 更新月份与年份标签
        this._monthLabel.text = this._selectedDate
            .toLocaleFormat("%OB")
            .capitalize();
        this._yearLabel.text = this._selectedDate.toLocaleFormat("%Y");

        // ---------- 更新农历头部（显示在“星期三 / 日期”下面） ----------
        if (this._lunarHeaderLabel) {
            let lunarNow = Lunar.fromSolar(
                Solar.fromYmd(
                    this._selectedDate.getFullYear(),
                    this._selectedDate.getMonth() + 1,
                    this._selectedDate.getDate(),
                ),
            );

            let lunarYearGanZhi = lunarNow.getYearInGanZhi(); // 年 例如：丙午
            let lunarYearShengXiao = lunarNow.getYearShengXiao(); // 生肖 例如：马
            let lunarMonth = lunarNow.getMonthInChinese(); // 月 例如：正
            let lunarMonthGanZhi = lunarNow.getMonthInGanZhi(); // 月 例如：庚寅
            let lunarDayGanZhi = lunarNow.getDayInGanZhi(); // 日 例如： 辛未
            // let lunarTimeGanZhi = lunarNow.getTimeGanZhi(); // 时 例如：辰

            this._lunarHeaderLabel.set_text(
                `${lunarYearGanZhi}(${lunarYearShengXiao}) ${lunarMonthGanZhi}(${lunarMonth}月) ${lunarDayGanZhi}`,
            );
        }
        // ---------- 农历头部更新结束 ----------

        // 清除旧的日历格子
        let children = this.actor.get_children();
        for (let i = this._firstDayIndex; i < children.length; i++)
            this.actor.remove_actor(children[i]);

        // 计算本月第一天所在的周
        let beginDate = new Date(this._selectedDate);
        beginDate.setDate(1);
        beginDate.setSeconds(0);
        beginDate.setHours(12);

        let daysToWeekStart = (7 + beginDate.getDay() - this._weekStart) % 7;
        beginDate.setTime(beginDate.getTime() - daysToWeekStart * MSECS_IN_DAY);

        let iter = new Date(beginDate);
        let row = 2; // 星期栏在 row=1，因此日历格子从 row=2 开始

        while (true) {
            let group = new Cinnamon.Stack();
            let button = new St.Button({});
            let vbox = new St.BoxLayout({ vertical: true });

            // 日期数字
            let dateLabel = new St.Label({ text: iter.getDate().toString() });
            vbox.add_actor(dateLabel);

            // 农历日（显示在格子里）
            if (this.show_lunar) {
                let solar = Solar.fromYmd(
                    iter.getFullYear(),
                    iter.getMonth() + 1,
                    iter.getDate(),
                );
                let lunar = Lunar.fromSolar(solar);

                let lunarDay = lunar.getDayInChinese();
                let festivals = lunar.getFestivals();
                let jieqi = lunar.getJieQi();

                let displayText =
                    festivals.length > 0
                        ? festivals[0]
                        : jieqi
                          ? jieqi
                          : lunarDay;

                let lunarLabel = new St.Label({
                    text: displayText,
                    style_class: "calendar-lunar-label",
                });

                vbox.add_actor(lunarLabel);
            }

            button.set_child(vbox);
            group.add_actor(button);

            // 事件小圆点
            let dot_box = new Cinnamon.GenericContainer({
                style_class: "calendar-day-event-dot-box",
            });
            dot_box.connect("allocate", this._allocate_dot_box.bind(this));
            group.add_actor(dot_box);

            let iterStr = iter.toUTCString();
            button.connect(
                "clicked",
                Lang.bind(this, function () {
                    if (!this.events_enabled) return;
                    this.setDate(new Date(iterStr), false);
                }),
            );

            // 样式
            let styleClass = "calendar-day-base calendar-day";
            if (_isWorkDay(iter)) styleClass += " calendar-work-day";
            else styleClass += " calendar-nonwork-day";

            if (row == 2) styleClass = "calendar-day-top " + styleClass;
            if (iter.getDay() == this._weekStart)
                styleClass = "calendar-day-left " + styleClass;

            if (_today(iter)) styleClass += " calendar-today";
            else if (iter.getMonth() != this._selectedDate.getMonth())
                styleClass += " calendar-other-month-day";
            else styleClass += " calendar-not-today";

            if (_sameDay(this._selectedDate, iter)) {
                button.add_style_pseudo_class("selected");
            }

            button.style_class = styleClass;

            let offsetCols = this.show_week_numbers ? 1 : 0;
            this.actor.add(group, {
                row: row,
                col: offsetCols + ((7 + iter.getDay() - this._weekStart) % 7),
            });

            // 周数
            if (this.show_week_numbers && iter.getDay() == 4) {
                let label = new St.Label({
                    text: iter.toLocaleFormat("%V"),
                    style_class: "calendar-day-base calendar-week-number",
                });
                this.actor.add(label, {
                    row: row,
                    col: 0,
                    y_align: St.Align.MIDDLE,
                });
            }

            // 事件颜色
            let color_set = this.events_manager.get_colors_for_date(iter);
            if (this.events_enabled && color_set !== null) {
                let node = dot_box.get_theme_node();
                let dot_box_width = node.get_width();
                let dot_width = dot_box_width / color_set.length;

                for (let i = 0; i < color_set.length; i++) {
                    let color = color_set[i];
                    let dot = new St.Bin({
                        style_class: "calendar-day-event-dot",
                        style: `background-color: ${color};`,
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    dot_box.add_actor(dot);
                }
            }

            iter.setTime(iter.getTime() + MSECS_IN_DAY);

            if (iter.getDay() == this._weekStart) {
                row++;
                if (row > 7) break;
            }
        }
    }
    _events_updated(events_manager) {
        this._queue_update();
    }

    _cancel_update() {
        if (this._update_id > 0) {
            Mainloop.source_remove(this._update_id);
            this._update_id = 0;
        }
    }

    _queue_update() {
        this._cancel_update();

        this._update_id = Mainloop.idle_add(
            Lang.bind(this, this._idle_do_update),
        );
    }

    _idle_do_update() {
        this._update_id = 0;
        this._update();
        return GLib.SOURCE_REMOVE;
    }

    _queue_set_date_idle(date) {
        this.setDate(date, false);
        this._set_date_idle_id = 0;
        return GLib.SOURCE_REMOVE;
    }

    queue_set_date(date) {
        if (this._set_date_idle_id > 0) return;

        this._set_date_idle_id = Mainloop.timeout_add(
            25,
            this._queue_set_date_idle.bind(this, date),
        );
    }

    _update_events_enabled(em) {
        this.events_enabled = this.events_manager.is_active();
        this._queue_update();
    }

    _onSettingsChange(object, key, old_val, new_val) {
        if (key == FIRST_WEEKDAY_KEY)
            this._weekStart = Cinnamon.util_get_week_start();

        this._buildHeader();
        this._update(false);
    }

    setDate(date, forceReload) {
        if (!_sameDay(date, this._selectedDate)) {
            this._selectedDate = date;
            this.emit("selected-date-changed", this._selectedDate);
            this._update(forceReload);
        } else {
            if (forceReload) this._update(forceReload);
        }
    }

    getSelectedDate() {
        return this._selectedDate;
    }

    todaySelected() {
        let today = new Date();
        return (
            this._selectedDate.getDate() == today.getDate() &&
            this._selectedDate.getMonth() == today.getMonth() &&
            this._selectedDate.getYear() == today.getYear()
        );
    }

    _onStyleChange(actor, event) {
        this._digitWidth = _getDigitWidth(this.actor) / Pango.SCALE;
        this._setWeekdateHeaderWidth();
    }

    _setWeekdateHeaderWidth() {
        if (
            !isNaN(this._digitWidth) &&
            this.show_week_numbers &&
            this._weekdateHeader
        ) {
            this._weekdateHeader.set_width(
                this._digitWidth * WEEKDATE_HEADER_WIDTH_DIGITS,
            );
        }
    }

    _onScroll(actor, event) {
        switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
            case Clutter.ScrollDirection.LEFT:
                this._onPrevMonthButtonClicked();
                break;
            case Clutter.ScrollDirection.DOWN:
            case Clutter.ScrollDirection.RIGHT:
                this._onNextMonthButtonClicked();
                break;
        }
    }

    _applyDateBrowseAction(yearChange, monthChange) {
        let oldDate = this._selectedDate;
        let newMonth = oldDate.getMonth() + monthChange;

        if (newMonth > 11) {
            yearChange += 1;
            newMonth = 0;
        } else if (newMonth < 0) {
            yearChange -= 1;
            newMonth = 11;
        }

        let newYear = oldDate.getFullYear() + yearChange;
        let newDayOfMonth = oldDate.getDate();
        let daysInMonth = 32 - new Date(newYear, newMonth, 32).getDate();

        if (newDayOfMonth > daysInMonth) newDayOfMonth = daysInMonth;

        let newDate = new Date();
        newDate.setFullYear(newYear, newMonth, newDayOfMonth);
        this.queue_set_date(newDate);
    }

    _onPrevYearButtonClicked() {
        this._applyDateBrowseAction(-1, 0);
    }

    _onNextYearButtonClicked() {
        this._applyDateBrowseAction(+1, 0);
    }

    _onPrevMonthButtonClicked() {
        this._applyDateBrowseAction(0, -1);
    }

    _onNextMonthButtonClicked() {
        this._applyDateBrowseAction(0, +1);
    }

    _allocate_dot_box(actor, box, flags) {
        let children = actor.get_children();
        if (children.length == 0) return;

        let a_dot = children[0];

        let box_width = box.x2 - box.x1;
        let box_height = box.y2 - box.y1;
        let [mw, nw] = a_dot.get_preferred_width(-1);
        let [mh, nh] = a_dot.get_preferred_height(-1);

        let max_children_per_row = Math.trunc(box_width / nw);

        let [found, max_rows] = actor
            .get_theme_node()
            .lookup_double("max-rows", false);

        if (found) max_rows = Math.trunc(max_rows);
        else max_rows = 2;

        let n_rows = Math.min(
            max_rows,
            Math.ceil(children.length / max_children_per_row),
        );

        let dots_left = children.length;
        let i = 0;

        for (
            let dot_row = 0;
            dot_row < n_rows;
            dot_row++, dots_left -= max_children_per_row
        ) {
            let dots_this_row = Math.min(dots_left, max_children_per_row);
            let total_child_width = nw * dots_this_row;

            let start_x = Math.floor((box_width - total_child_width) / 2);

            let cbox = new Clutter.ActorBox();
            cbox.x1 = start_x;
            cbox.y1 = dot_row * nh;
            cbox.x2 = cbox.x1 + nw;
            cbox.y2 = cbox.y1 + nh;

            while (i < dot_row * max_children_per_row + dots_this_row) {
                children[i].allocate(cbox, flags);

                cbox.x1 += nw;
                cbox.x2 += nw;

                i++;
            }
        }
    }
};

Signals.addSignalMethods(Calendar.prototype);
