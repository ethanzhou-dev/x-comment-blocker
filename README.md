# X(Twitter) Comment Blocker

用于自动屏蔽 X (Twitter) 评论区垃圾信息与引流机器人的浏览器插件。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gagacedifiphcndckimeihhcbcclkach.svg)](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)

## 功能

- **云端词库**：自动同步并定期更新公共垃圾屏蔽词库。
- **自定义词库**：支持手动添加、编辑屏蔽词，并提供本地文件的导入/导出功能。
- **高级过滤**：
  - 按用户名包含屏蔽词过滤。
  - 按特殊字符或 emoji 过滤。
  - 支持仅作用于推文评论区。
- **快捷操作**：选中网页文本后，右键可将其快速加入自定义屏蔽词库。
- **数据与历史**：记录屏蔽数量，并可查看最近拦截的 100 条评论。

## 安装

### 1. 从 Chrome 应用商店安装

您可以在 Chrome 应用商店获取最新版本：
👉 [X(Twitter) Comment Blocker - Chrome 应用商店](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)

### 2. 手动安装

适用于基于 Chromium 的浏览器（如 Chrome, Edge）

1. 下载或克隆本项目代码。
2. 打开扩展程序页面：`chrome://extensions/` 或 `edge://extensions/`。
3. 开启页面右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择下载的 `x-comment-blocker` 文件夹。

## 使用

- **全局控制**：点击扩展图标，通过右上角开关启用或关闭插件。
- **词库管理**：在弹窗界面中管理自定义词库，可添加、删除，或通过顶部图标进行备份和恢复。
- **云端同步**：勾选“云端词库”开启自动更新，点击“同步”按钮可立即拉取最新列表。
- **快速添加**：浏览网页时遇到需要屏蔽的词，直接选中并右键点击添加。
- **拦截记录**：在弹窗统计区点击“查看”，可浏览最近的屏蔽记录。

## 隐私

所有过滤规则与数据均在浏览器本地处理。不收集任何账号信息、浏览记录或自定义词库内容。网络请求仅用于获取公开的云端词库。

## 协议

本项目基于 [MIT License](./LICENSE) 协议开源。
