# Chinese Lunar Calendar Applet for Cinnamon

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)

这是一个为 Cinnamon 桌面环境开发的农历日历小程序，基于官方的日历小部件（`calendar@cinnamon.org`）并集成了 [lunar-javascript](https://github.com/your-fork-or-original) 库，在日历格子中显示农历日期、节气、节日等信息。

**⚠️ 注意：该项目为个人学习/定制用途，可能不会长期维护，欢迎 Fork 自行改进。**

## ✨ 功能特性

- 在标准 Cinnamon 日历上增加农历显示
- 支持农历日、干支、生肖、节气
- 可选择是否显示农历（通过设置开关）
- 农历头部显示年月干支、生肖等信息
- 保留原日历的所有功能（事件显示、周数等）
- 多语言支持（未启用）

## 📦 安装方法

### 手动安装
1. 下载本仓库代码：

```bash
   git clone https://github.com/lnxyz/chinese-calendar-cinnamon.git
```

2. 将文件夹复制到 Cinnamon 的 applets 目录：
```
cp -r chinese-calendar-cinnamon ~/.local/share/cinnamon/applets/chinese-calendar@你的id
（请将 @你的id 替换为您在 metadata.json 中定义的 uuid）
```
重启 Cinnamon（Alt+F2 输入 r 回车）

右键点击面板 → “添加到面板” → 选择“中国日历”

## ✨ 功能预览

以下是在 Cinnamon 默认主题（亮色）和暗色主题下日历的显示效果：

| 亮色主题 | 暗色主题 |
| :------: | :------: |
| ![亮色主题](screenshot.png) | ![暗色主题](screenshot_dark.png) |

## 使用说明

* 添加后，点击面板上的日期即可打开日历。

* 右键点击小程序 → “设置” 可以配置是否显示农历、是否显示事件、自定义日期格式等。

* 农历信息显示在：

  * **日历格子内**：每个日期下方显示农历日（或节气/节日）。

  * **日历头部**：显示当前选中日期的农历年干支、生肖、月干支、日干支。

## 🧩 依赖

* Cinnamon 桌面环境（版本 ≥ 5.0 测试）

* GLib、Gio、St 等标准 Cinnamon 模块（通常已预装）

* [lunar-javascript](https://github.com/6tail/lunar-javascript) （已内嵌在代码中，无需额外安装）

## 📚 项目背景

本项目是在 Cinnamon 官方日历小程序 `calendar@cinnamon.org` 的基础上，集成了 [lunar-javascript](https://github.com/6tail/lunar-javascript) 库实现的。原官方日历由 Cinnamon 团队开发，遵循 GPL v2 许可证；lunar-javascript 使用 MIT 许可证。本整合项目遵循 GPL v3 许可证。

## 🤝 贡献与修改

由于个人精力有限，本项目不会积极维护。欢迎您 fork 并自行修改。

## 📄 许可证

* 本项目的核心修改部分采用 [GPL v3](https://LICENSE) 许可证。

* 官方日历部分来源于 Cinnamon，其许可证为 GPL v2。

* lunar-javascript 库采用 MIT 许可证，其版权归原作者所有。

具体许可证文件请见仓库中的 `LICENSE` 文件。

## 🙏 致谢

* [Cinnamon 官方日历小部件](https://github.com/linuxmint/cinnamon/tree/master/files/usr/share/cinnamon/applets/calendar%2540cinnamon.org)

* [lunar-javascript](https://github.com/6tail/lunar-javascript) 农历计算库
