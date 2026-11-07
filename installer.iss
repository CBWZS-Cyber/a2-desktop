; A2 兴海智学 · 桌面助手 安装脚本（Inno Setup 6）
; 编译：ISCC.exe installer.iss
; 产物：dist\A2兴海智学_安装版_1.0.0.exe

#define MyAppName "A2兴海智学"
; 版本号由 build/build.js 从 package.json 读取后经 /DMyAppVersion 传入，禁止在此硬编码
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppPublisher "哈尔滨工程大学 · A2 团队"
#define MyAppExeName "A2兴海智学.exe"

[Setup]
AppId={{8F3C1E42-5A7D-4B2E-9C61-2D8A7B41E903}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://learnest.cn
AppSupportURL=https://learnest.cn
AppUpdatesURL=https://learnest.cn
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=A2兴海智学_安装版_{#MyAppVersion}
SetupIconFile=build\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
MinVersion=10.0
CloseApplications=yes
RestartApplications=no
AllowNoIcons=yes
DisableWelcomePage=no

[Languages]
; 官方 Inno Setup 安装包不含中文语言文件，故随仓库带上（build/languages/），
; 避免"本机能编、CI 编不了"这种环境依赖。
Name: "chinesesimplified"; MessagesFile: "build\languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式（小张图标）"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
Source: "build\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "使用说明.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Comment: "小张在桌面等你"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; Comment: "点开就是学习中心"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}（小张会出现在右下角）"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--quit"; Flags: runhidden; RunOnceId: "QuitApp"
; 卸载时清掉开机自启项（值名 = 应用的 AppUserModelId，由 Electron 写入）
Filename: "{cmd}"; Parameters: "/c reg delete ""HKCU\Software\Microsoft\Windows\CurrentVersion\Run"" /v ""cn.learnest.a2.desktop"" /f"; Flags: runhidden; RunOnceId: "DelAutostart"
