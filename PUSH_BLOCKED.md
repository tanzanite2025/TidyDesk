# GitHub Push 被阻止

**问题**: GitHub 检测到历史提交中包含 Token

**解决方案**: 访问以下 URL 允许这个 secret：

https://github.com/tanzanite2025/TidyDesk/security/secret-scanning/unblock-secret/3E8r9N5fklW86EwCyw2GFUOMTSN

**说明**:
1. 点击上面的链接
2. 在 GitHub 页面中点击 "Allow secret" 或类似按钮
3. 然后重新推送：`git push origin main`

**注意**: Token 已经在最新的提交中被移除，只是历史提交中还有。
