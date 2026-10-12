# 阿贝创作助手 0.1.0

原创绘本、系列分镜、图片/配音验收，以及将本地成品同步到阿贝账号并投稿。制作使用当前客户端的模型和文件能力；助手不调用阿贝付费AI生成。远程服务为 `https://mcp.abeiai.com/mcp`，API授权资源为 `https://mcp.abeiai.com/api/creator/v1`。本仓库独立，无私有业务源码、凭证、真实配置或工作区依赖。

## 普通用户安装

从项目发布者提供的0.1.0 Release下载下表对应文件，校验同一Release的SHA256SUMS。构建本身不代表已发布到GitHub或通过客户端市场审核；尚未发布时，使用维护者交付的同名本地文件。不要运行来源不明的远程安装脚本。

| 客户端 | 文件与入口 | 本地媒体/运行时 | 当前验证边界 |
|---|---|---|---|
| Codex | abei-creator-codex-0.1.0.zip：市场目录内plugins/abei-creator含portable plugin.json、mcp.json和Skill；原生OAuth远程MCP | 配合已验收系统的独立助手窄上传，无需Node | SDK协议及CLI 0.150.1安装/启用/列表通过；会话工具调用及云入口OAuth未验收 |
| Claude Code | abei-creator-claude-code-0.1.0.zip，标准.claude-plugin及.mcp.json | 远程OAuth+独立助手；可手动添加独立助手stdio并指定--profile claude-code | 本机构建，无Claude CLI实际验收 |
| Claude Desktop | abei-creator-desktop-0.1.0.mcpb，桌面扩展导入 | MCPB使用桌面自带Node；设备授权，自动分片上传 | 官方validator及Desktop 1.7196.0导入预览通过；设备策略禁用扩展目录，实际安装被阻止 |
| Claude Cowork | abei-creator-claude-cowork-0.1.0.zip；或设置中添加远程连接，选择自动OAuth注册 | 远程请求来自云端。只有宿主确实允许沙箱文件、执行、网络且能私有传递会话时，才能窄上传 | 包中无根bin/；Desktop本地扩展不能供Cowork调用，实际云文件上传未验收 |
| WorkBuddy >=5.0.0 | abei-creator-workbuddy-0.1.0.zip：单个远程MCP+Skill | 原生OAuth+独立助手；可选本地托管Node配置见下文 | 本地配置生成通过；当前自定义连接器UI未打开编辑器，实际安装/OAuth未验收 |
| DeepSeek Harness 0.2.0-rc.2 | abei-creator-deepseek-0.1.0.zip解压，在添加插件选择本地目录 | 预编译ESM在应用运行时内执行；ctx.tools/ctx.skills，设备授权 | 官方tag契约测试及实际安装/启用通过；会话工具调用、设备授权与上传未验收 |
| 豆包Work PC | abei-creator-doubao-work-0.1.0.zip，仅Skill与指南 | 缺少可验证的原生插件/连接入口 | 待适配，普通豆包客户端不计为Work PC验证 |

桌面普通用户不需自行安装Node或Python。独立助手文件：`abei-creator-darwin-arm64`、`abei-creator-darwin-x64`、`abei-creator-linux-x64`、`abei-creator-linux-arm64`、`abei-creator-windows-x64.exe`。本次实际执行macOS arm64，并在独立无网络Linux arm64容器执行版本检查；其他平台是交叉编译，需在对应平台验收后才能声称支持。文件未签名/公证；不要通过关闭系统安全机制绕过安装限制。Windows x64为交叉编译产物，独立助手与Desktop/WorkBuddy/DeepSeek托管运行时路径均需Windows实机验收。Windows凭证通过系统PowerShell一次性设置仅当前用户的受保护ACL，失败即停止保存；没有绕过为公开权限。

macOS/Linux运行用户选择的下载文件（若下载未保留执行权限，赋予该文件执行权限）：

```sh
chmod +x ./abei-creator-darwin-arm64
./abei-creator-darwin-arm64 --version
./abei-creator-darwin-arm64 auth login --wait --profile cli
```

授权页与用户码只输出到stderr。`auth login`不加`--wait`时马上返回，稍后运行`auth poll`；`auth status`仅检查本地状态，不触发网络；`auth logout`先撤销再清理，远端失败时保留状态供重试。默认只申请creator:read和creator:write，任务包括投稿可显式加 `--scopes 'creator:read creator:write creator:submit'`。扩大范围必须重新授权。

WorkBuddy本地媒体可选路径：下载本次构建的 `abeiai-creator-0.1.0.tgz`（这是实际交付的预打包文件，不是假定已发布的npm包），用独立助手生成一份新配置，再在WorkBuddy自定义MCP导入：

```sh
./abei-creator-darwin-arm64 adapter workbuddy --archive /绝对路径/abeiai-creator-0.1.0.tgz --output /选定目录/workbuddy-local
```

配置只包含一个stdio MCP，使用WorkBuddy托管Node22及npx安装这个**本地tgz**，不更改全局客户端配置。首次调用`creator_login_start`完成设备授权。此入口profile为workbuddy，与其他客户端隔离。该配置生成路径和包可执行已测试，WorkBuddy实际安装待验收。选择远程或本地其中之一，避免工具重名。

Codex CLI 0.150.1的本地市场安装命令是 `codex plugin marketplace add <市场目录>`、`codex plugin add abei-creator@abei-local`，不是plugin install。本Codex ZIP已包含.agents/plugins/marketplace.json，解压根目录就是市场目录，实际插件根目录为plugins/abei-creator。原生远程OAuth优先使用自动发现/DCR。发布的portable MCP schema与OpenAI vendor auth扩展文档目前不完全一致，本包只使用schema支持的远程type/url，不声称vendor扩展已验证。若客户端需要显式配置，直接在客户端添加该远程MCP并完成OAuth；不手填长期token。CLI可用 `codex mcp add abei-creator --url https://mcp.abeiai.com/mcp`，随后 `codex mcp login abei-creator --oauth-client-registration dcr --scopes creator:read,creator:write`；任务包含投稿时再显式加入creator:submit。

Claude Code可用 `claude --plugin-dir /解压目录` 在会话中加载；`claude plugin validate /解压目录` 是官方验证入口（本机未安装该CLI）。Cowork通过自定义连接添加同一MCP URL，或按其个人插件导入界面选取Cowork包；后者安装格式仍需实际入口验收。

## 同步与恢复

参见[核心Skill](skills/abei-creator/SKILL.md)及[清单约定](skills/abei-creator/references/sync.md)。`sync`仅保存，显式submit才投稿。manifest.assets只读明确列出的项目内文件，拒绝路径和symlink越界；`upload`和`describe`只读用户明确指定的单文件。不会从作品正文或API响应提取本地路径。

远程MCP与API audience隔离。原生远程授权后的本地文件传输用 `describe` + `creator_upload_create` + `transfer FILE --session-stdin`，只传短期上传capability，无须第二次广泛登录。宿主必须支持受限、私有值传递；不可把capability写入命令文本、日志或对话。缺少此能力的云端入口只能保留草稿或使用已获授权的本地助手入口，不能声称已上传。

凭证在 `~/.abei-creator/<profile>/state.json`，POSIX目录0700/文件0600（Windows用当前用户ACL），原子落盘，刷新后持久化再执行业务。profile稳定：cli、codex-local、claude-code、claude-desktop、workbuddy、deepseek；每个profile使用不同DCR客户端名称和授权，撤销互不混用。自定义ABEI_CREATOR_STATE_DIR只能由启动环境配置，不是作品/工具参数。不要放在作品仓库内。API失效不自动扩大权限。刷新响应丢失可能需要重新设备授权，不能重用已消费refresh token。

上传以SHA256及固定externalId恢复，1MiB分片，查询offset处理丢响应/409/503，连续失败最多恢复3次；503零进度时仍按服务返回的已提交offset续传。重启读取私有会话状态。过期capability通过原来授权的create操作旋转，不能用capability读取媒体或作品。预览地址位于new.abeiai.com并需要正常网站登录。

## 升级与兼容

插件SemVer0.1.0，清单/作品schemaVersion1。先读取服务capabilities；不支持的schema拒绝同步，保留本地稿。升级只替换插件/助手文件，不修改externalId或私有profile目录；新增scope必须用户明确重授权。

升级前停止所有使用该profile的旧助手进程，再替换文件并重启；不要混用新旧锁协议。遗留孤儿锁可由新助手回收，凭证目录保持不变。Codex Git市场用 `codex plugin marketplace upgrade <市场名>` 刷新，再按客户端提示更新；DeepSeek rc.2当前提示卸载/重装升级，保留助手profile目录。Desktop重新导入新mcpb，WorkBuddy重新导入对应配置（本地模式生成新tgz路径）。远端撤销通过主站授权连接页或该入口logout。

## 维护者构建（用户无需执行）

需要Node20+、npm、zip及构建网络。包与monorepo隔离：

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run release
npm run test:artifacts
```

Bun1.4.3只用于编译自包含助手；esbuild与SDK精确锁定。release脚本只从显式公开文件清单打包，输出ZIP/MCPB/无依赖Node TGZ/独立二进制及SHA256SUMS到release/。不自动上传、部署、安装市场或修改用户配置。核心包npm依赖保留开发测试需要，但用户TGZ使用已bundle的单文件且没有运行时registry依赖。

官方依据：[OpenAI插件](https://developers.openai.com/plugins/build/plugins)、[Claude插件](https://code.claude.com/docs/en/plugins-reference)、[MCPB](https://github.com/modelcontextprotocol/mcpb)、[WorkBuddy连接器](https://open.workbuddy.cn/docs/connector)、[DeepSeek rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2)。客户端市场接受、真实账号OAuth、实际图像/声音生成和各入口端到端验收均不能由manifest或模拟测试推断。
