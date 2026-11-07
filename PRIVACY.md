# Privacy Policy · 隐私政策

**A2 Learnest Desktop / A2 兴海智学桌面端**
Last updated: 2026-11-07

This policy covers two distinct things, because they handle data differently:

- **The desktop shell in this repository** — the Electron app that shows a
  character on your desktop and opens the Learnest website.
- **The Learnest web service** — the website the app displays
  (`https://learnest.cn`), which provides the study features.

## 1. Desktop shell

The desktop shell **does not collect, transmit, or sell any personal data**. It
contains no analytics, no telemetry, no crash reporting and no advertising SDK.

Locally it stores exactly two things, both in your own user profile
(`%APPDATA%\A2兴海智学\`):

| Stored | Purpose |
| --- | --- |
| Pet window position | Remembers where you dragged the character |
| Autostart preference | Remembers whether you enabled start-with-Windows |

These never leave your computer and are removed when you uninstall the app.

The only network request the shell makes on its own is loading the Learnest web
site (and, if that fails, an offline notice page served from disk).

## 2. Learnest web service

To use the study features you sign in to `https://learnest.cn`. When signed in,
the service processes:

| Data | Why |
| --- | --- |
| Mobile phone number + SMS verification code | Account creation and sign-in |
| Content you upload (wrong-answer photos, textbook pages, notes) | Producing the organised answer set and the diagnosis you asked for |
| Your questions to the assistant and its answers | Keeping your study history so you can review it |
| Basic request metadata (time, coarse client type) | Operating and securing the service |

Uploaded content and questions may be sent to a third-party large-language-model
API in order to generate the response. That processing is limited to producing
your result; the content is not used to train models by us, and is not sold or
shared for advertising.

Data is stored on servers we operate. We keep it for as long as your account
exists, and delete it when you delete your account.

## 3. Children

The service is intended for university students. It is not directed at children
under 14.

## 4. Your choices

You may request access to, correction of, or deletion of your data by opening an
issue at
<https://github.com/CBWZS-Cyber/a2-desktop/issues> — please do not include
personal data in the issue itself; we will follow up with a private channel.

## 5. Changes

Material changes to this policy will be noted in this file's git history and in
the release notes of the desktop app.

---

## 中文摘要

- **桌面外壳（本仓库）不收集任何数据**，没有统计、没有崩溃上报、没有广告。
  它只在本地记住两件事：桌宠窗口位置、是否开机自启，卸载即删。
- **学习功能在 `learnest.cn` 上**：登录需要手机号与短信验证码；你上传的错题、
  教材、提问会被处理以生成整理结果与诊断；内容可能调用第三方大模型 API 处理，
  仅用于生成你的结果，不用于训练、不出售。
- 数据存放在我们自运营的服务器上，账号删除时一并删除。
- 服务面向大学生，不面向 14 岁以下儿童。
- 查询、更正或删除数据，请到
  <https://github.com/CBWZS-Cyber/a2-desktop/issues> 提出（不要在 issue 里写个人信息）。
