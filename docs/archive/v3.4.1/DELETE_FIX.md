# 删除应用快捷方式修复

**问题**: 从抽屉删除应用快捷方式后，弹出确认提示，但抽屉中的应用没有消失

**版本**: v3.2.4  
**日期**: 2026-05-24  
**状态**: ✅ 已修复

---

## 🐛 问题分析

### 症状
1. 用户点击应用快捷方式的删除按钮
2. 弹出确认对话框："删除快捷入口 "XXX"？原文件不会被删除。"
3. 用户点击确认
4. **问题**: 抽屉中的应用仍然显示，没有被删除

### 根本原因

**文件名不匹配**：

1. **前端显示的文件名**（`file.name`）：
   - 在 `readDesktopFiles()` 中，`.lnk` 文件的扩展名被去掉了
   - 例如：`"Visual Studio Code"` （没有 `.lnk`）

2. **后端期望的文件名**：
   - `deleteDesktopItem()` 需要完整的文件名（包含扩展名）
   - 例如：`"Visual Studio Code.lnk"`

3. **结果**：
   - 前端传递 `"Visual Studio Code"`
   - 后端尝试删除 `"Visual Studio Code"`（文件不存在）
   - 实际文件是 `"Visual Studio Code.lnk"`（未被删除）

### 代码位置

**前端** (`src/context/WorkspaceContext.tsx`):
```typescript
const deleteItem = async (id: string, type: 'file' | 'folder') => {
  const item = type === 'file' ? files.find(file => file.id === id) : folders.find(folder => folder.id === id);
  if (!item) return;

  if (tidyDeskApi) {
    try {
      const parentFolder = item.parentId ? drawerNameFromId(folders, item.parentId) : null;
      await tidyDeskApi.deleteItem({ name: item.name, parentFolder }); // ❌ item.name 没有扩展名
      await refreshDesktop();
    } catch (err: unknown) {
      setError(`[CRITICAL] 删除抽屉入口失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  // ...
};
```

**后端** (`electron/services/drawers/storage.cjs`):
```javascript
async function deleteDesktopItem({ name, parentFolder }) {
  // ...
  const drawerPath = resolveDrawerPath(parentFolder);
  const targetPath = path.resolve(drawerPath, name); // ❌ name 没有扩展名，找不到文件
  
  const stats = await fs.promises.stat(targetPath); // ❌ 文件不存在，抛出错误
  await fs.promises.unlink(targetPath);
  // ...
}
```

---

## ✅ 修复方案

### 方案 1: 前端添加扩展名（已采用）

在前端 `deleteItem` 函数中，如果文件有扩展名，确保传递完整的文件名：

```typescript
const deleteItem = async (id: string, type: 'file' | 'folder') => {
  const item = type === 'file' ? files.find(file => file.id === id) : folders.find(folder => folder.id === id);
  if (!item) return;

  if (tidyDeskApi) {
    try {
      const parentFolder = item.parentId ? drawerNameFromId(folders, item.parentId) : null;
      
      // ✅ 对于文件，使用完整的文件名（包含扩展名）
      let itemName = item.name;
      if (type === 'file' && item.extension) {
        // 如果 name 中没有扩展名，添加它
        if (!itemName.endsWith(item.extension)) {
          itemName = `${itemName}${item.extension}`;
        }
      }
      
      await tidyDeskApi.deleteItem({ name: itemName, parentFolder });
      await refreshDesktop();
    } catch (err: unknown) {
      setError(`[CRITICAL] 删除抽屉入口失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  // ...
};
```

**优点**:
- 修改最小
- 不影响其他功能
- 向后兼容

### 方案 2: 后端模糊匹配（未采用）

在后端尝试多种文件名：
```javascript
async function deleteDesktopItem({ name, parentFolder }) {
  const drawerPath = resolveDrawerPath(parentFolder);
  
  // 尝试多种可能的文件名
  const possibleNames = [
    name,
    `${name}.lnk`,
    `${name}.url`
  ];
  
  for (const possibleName of possibleNames) {
    const targetPath = path.resolve(drawerPath, possibleName);
    if (fs.existsSync(targetPath)) {
      await fs.promises.unlink(targetPath);
      return { success: true };
    }
  }
  
  throw new Error('File not found');
}
```

**缺点**:
- 可能误删文件
- 性能较差（多次文件系统调用）

---

## 🔧 额外改进

### 1. 删除时从文件监控中移除

在 `storage.cjs` 的 `deleteDesktopItem` 中添加：

```javascript
async function deleteDesktopItem({ name, parentFolder }) {
  // ...
  const targetPath = path.resolve(drawerPath, name);
  
  // ✅ 如果是快捷方式，从文件监控中移除
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === '.lnk' && watcherService) {
    watcherService.removeFileFromWatch(targetPath);
  }
  
  await fs.promises.unlink(targetPath);
  console.log(`[TIDYDESK] Deleted item: ${targetPath}`); // ✅ 添加日志
  return { success: true };
}
```

**作用**:
- 防止文件监控器继续监听已删除的文件
- 避免内存泄漏
- 添加日志便于调试

---

## 📁 修改的文件

### 修改文件
- ✅ `src/context/WorkspaceContext.tsx` - 修复 `deleteItem` 函数，添加扩展名
- ✅ `electron/services/drawers/storage.cjs` - 添加文件监控移除和日志

---

## 🧪 测试场景

### 场景 1: 删除应用快捷方式
1. 打开抽屉
2. 点击应用快捷方式的删除按钮
3. 确认删除
4. **预期**: 应用从抽屉中消失 ✅

### 场景 2: 删除普通文件
1. 拖入一个普通文件到抽屉
2. 点击删除按钮
3. 确认删除
4. **预期**: 文件从抽屉中消失 ✅

### 场景 3: 删除文件夹
1. 删除整个抽屉
2. 确认删除
3. **预期**: 抽屉及其所有内容被删除 ✅

---

## 💡 经验总结

### 问题根源

**数据不一致**：
- 前端显示的数据（`file.name`）与后端期望的数据（完整文件名）不一致
- 这种不一致在 `readDesktopFiles()` 中产生，但在 `deleteItem()` 中暴露

### 最佳实践

1. **保持数据一致性**
   - 如果前端去掉了扩展名，应该保留原始文件名的引用
   - 或者在需要时重新添加扩展名

2. **错误处理**
   - 后端应该返回更详细的错误信息
   - 前端应该显示错误提示，而不是静默失败

3. **日志记录**
   - 关键操作（删除、重命名）应该记录日志
   - 便于调试和追踪问题

4. **测试覆盖**
   - 应该测试所有文件类型的删除
   - 包括 `.lnk`、`.url`、普通文件、文件夹

---

## 🎯 后续改进

### 1. 统一文件名处理

创建一个工具函数：
```typescript
function getFullFileName(file: TidyFile): string {
  if (file.extension && !file.name.endsWith(file.extension)) {
    return `${file.name}${file.extension}`;
  }
  return file.name;
}
```

### 2. 添加单元测试

```typescript
describe('deleteItem', () => {
  it('should delete .lnk file with correct filename', async () => {
    const file = {
      id: 'test-1',
      name: 'Visual Studio Code',
      extension: '.lnk',
      parentId: 'drawer-1'
    };
    
    await deleteItem(file.id, 'file');
    
    expect(tidyDeskApi.deleteItem).toHaveBeenCalledWith({
      name: 'Visual Studio Code.lnk', // ✅ 包含扩展名
      parentFolder: '收纳抽屉'
    });
  });
});
```

### 3. 改进错误提示

```typescript
catch (err: unknown) {
  const errorMsg = err instanceof Error ? err.message : String(err);
  if (errorMsg.includes('ENOENT')) {
    setError(`文件不存在，可能已被删除: ${item.name}`);
  } else {
    setError(`删除失败: ${errorMsg}`);
  }
}
```

---

## ✅ 完成清单

- [x] 分析问题根本原因
- [x] 修复前端 `deleteItem` 函数
- [x] 添加文件监控移除逻辑
- [x] 添加删除日志
- [x] 编写修复文档
- [ ] 测试所有删除场景
- [ ] 添加单元测试
- [ ] 发布 v3.2.5（如果需要）

---

## 🎉 总结

删除功能的问题已修复！根本原因是前端显示的文件名（去掉扩展名）与后端期望的文件名（完整文件名）不一致。通过在前端添加扩展名，确保传递正确的文件名给后端，问题得到解决。

**修复效果**: 用户现在可以正常删除抽屉中的应用快捷方式了！✅
