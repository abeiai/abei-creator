# 同步清单与命令

清单schemaVersion为1；远程API和作品schema也为1；插件版本独立为0.1.0。具体字段参见安装包schemas/book.schema.json、album.schema.json、manifest.schema.json。

绘本示例（正文4页，当前只保存未完成草稿）：

```json
{"schemaVersion":1,"kind":"BOOK","work":{"schemaVersion":1,"externalId":"my-story-01","expectedVersion":0,"title":"小树的一天","style":"水彩","pageCount":4,"pages":[]},"assets":{"cover":{"path":"art/cover.png","kind":"IMAGE","mimeType":"image/png"}},"bindings":{"coverAssetId":"cover"}}
```

assets只列出实际选择的本地文件，相对于用户选定项目根目录，拒绝../、绝对路径和越界符号链接。bindings允许coverAssetId或pages.0.imageAssetId/pages.0.audioAssetId等字段。成功返回nextExpectedVersion；用户核对后更新本地work.expectedVersion，保持externalId不变。相同素材与清单可重试，409则先读取并核对。未填写素材externalId时，助手根据作品类型/标识、素材键、内容SHA256、大小、kind与MIME生成固定长度的素材版本标识；替换同名文件后会新建素材并更新作品绑定，作品externalId保持不变。显式填写的素材externalId仍是不可变标识，内容或格式变化须使用新的素材标识。首次从旧助手升级同步可能为原素材建立新标识，不会覆盖原素材。

```sh
abei-creator auth login --wait --profile cli
abei-creator sync book.json --project /用户选定的项目 --profile cli
abei-creator call creator_book_validate '{"id":"保存返回的ID"}' --profile cli
abei-creator call creator_book_submit '{"id":"保存返回的ID","expectedVersion":1}' --profile cli
```

最后一条仅用于已包含投稿的任务；需要creator:submit授权。专辑kind为ALBUM，work包含title、summary、coverAssetId与items，每项bookId、expectedVersion、displayName固定所选绘本版本。

断点恢复状态在助手的私有凭证目录，不在项目中。上传1MiB分片；网络丢响应、409或503先查询已提交offset再续传，最多三次连续恢复。会话过期需通过原有授权重新创建。媒体只作为HTTP分片传输，不作为大工具参数。

原生远程窄上传：`abei-creator describe /明确选定的素材` → `creator_upload_create` → `abei-creator transfer /同一素材 --session-stdin`。stdin由支持私有值传递的执行工具提供create结果；不要在终端命令文本里插入capability。若宿主会把stdin记录到聊天或日志，不能使用此通道。已经完成后返回不含capability的素材ID，填回作品。
