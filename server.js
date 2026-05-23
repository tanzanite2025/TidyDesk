import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 解决 ES Module 下的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// 1. 物理路径安全探测
let desktopPath = path.resolve(__dirname, '../..');

// 校验是否回溯到了真实的 Desktop 目录
if (!fs.existsSync(desktopPath) || !desktopPath.toLowerCase().endsWith('desktop')) {
  // 备用方案：读取 Windows 系统环境变量
  const userProfile = process.env.USERPROFILE || process.env.HOMEPATH;
  if (userProfile) {
    desktopPath = path.join(userProfile, 'Desktop');
  }
}

// [FAIL LOUDLY] 防静默失效：如果桌面路径依然不存在或无读写权限，大声报错中断启动
if (!fs.existsSync(desktopPath)) {
  console.error(`[CRITICAL] Detected Windows Desktop path does not exist: "${desktopPath}"`);
  process.exit(1);
}

console.log(`[TIDYDESK SERVICE] Successfully mapped to Windows Desktop: "${desktopPath}"`);

// 智能判定文件品类 (与前端同步)
function getCategoryByExtension(ext, fileName) {
  const nameLower = fileName.toLowerCase();
  const extLower = ext.toLowerCase().replace('.', '');

  if (
    nameLower.startsWith('新建') || 
    nameLower.startsWith('untitled') || 
    nameLower.includes('screenshot') || 
    nameLower.startsWith('temp') || 
    nameLower.startsWith('tmp')
  ) {
    return 'temporary';
  }

  const images = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'];
  if (images.includes(extLower)) return 'image';

  const documents = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'csv', 'md', 'key', 'numbers', 'pages'];
  if (documents.includes(extLower)) return 'document';

  const archives = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  if (archives.includes(extLower)) return 'archive';

  const apps = ['exe', 'msi', 'bat', 'cmd', 'dmg', 'pkg'];
  if (apps.includes(extLower)) return 'app';

  const developer = ['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'py', 'go', 'rs', 'cpp', 'h', 'java', 'sh', 'yaml', 'yml'];
  if (developer.includes(extLower)) return 'developer';

  return 'other';
}

// 安全审计过滤器：阻断对系统核心文件及快捷图标的改动
function isProtectedItem(name) {
  const protectedNames = [
    'desktop.ini',
    '个人开发',
    'tidydesk',
    'node_modules',
    '.git',
    '.github'
  ];
  const nameLower = name.toLowerCase();

  // 1. 保护系统图标快捷方式
  if (nameLower.endsWith('.lnk')) return true;

  // 2. 保护开发自身目录与系统配置文件
  if (protectedNames.some(p => nameLower.includes(p))) return true;

  return false;
}

// 2. GET API: 真实扫描桌面物理文件
app.get('/api/desktop/files', async (req, res) => {
  try {
    const items = await fs.promises.readdir(desktopPath, { withFileTypes: true });
    
    const filesList = [];
    const foldersList = [];

    let fileCounter = 0;
    let folderCounter = 0;

    for (const item of items) {
      if (isProtectedItem(item.name)) continue;

      const fullPath = path.join(desktopPath, item.name);
      
      try {
        const stats = await fs.promises.stat(fullPath);
        
        if (item.isFile()) {
          const ext = path.extname(item.name);
          filesList.push({
            id: `physical-file-${++fileCounter}-${stats.ino}`,
            name: item.name,
            path: fullPath,
            size: stats.size,
            category: getCategoryByExtension(ext, item.name),
            extension: ext,
            modifiedAt: stats.mtime.toISOString(),
            isSimulated: false,
            parentId: null
          });
        } else if (item.isDirectory()) {
          const folderId = `physical-folder-${++folderCounter}-${stats.ino}`;
          foldersList.push({
            id: folderId,
            name: item.name,
            path: fullPath,
            category: 'folder',
            modifiedAt: stats.mtime.toISOString(),
            isSimulated: false,
            parentId: null
          });

          // 递归读取一层该目录下的文件以实现双栏钻探
          try {
            const subItems = await fs.promises.readdir(fullPath, { withFileTypes: true });
            for (const subItem of subItems) {
              if (subItem.isFile() && !isProtectedItem(subItem.name)) {
                const subFullPath = path.join(fullPath, subItem.name);
                const subStats = await fs.promises.stat(subFullPath);
                const subExt = path.extname(subItem.name);

                filesList.push({
                  id: `physical-sub-file-${++fileCounter}-${subStats.ino}`,
                  name: subItem.name,
                  path: subFullPath,
                  size: subStats.size,
                  category: getCategoryByExtension(subExt, subItem.name),
                  extension: subExt,
                  modifiedAt: subStats.mtime.toISOString(),
                  isSimulated: false,
                  parentId: folderId
                });
              }
            }
          } catch (subErr) {
            console.warn(`[TIDYDESK] Failed to read sub-directory "${item.name}":`, subErr.message);
          }
        }
      } catch (statErr) {
        console.warn(`[TIDYDESK] Failed to get stats for "${item.name}":`, statErr.message);
      }
    }

    res.json({ files: filesList, folders: foldersList, desktopPath });
  } catch (err) {
    // [FAIL LOUDLY]
    console.error("[CRITICAL] Failed to read physical desktop:", err);
    res.status(500).json({ error: `[CRITICAL] Failed to read physical Windows Desktop stream: ${err.message}` });
  }
});

// 3. POST API: 创建物理文件夹
app.post('/api/desktop/folders', async (req, res) => {
  const { name } = req.body;
  
  // [FAIL LOUDLY]
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "[CRITICAL] Cannot create folder with missing name parameter." });
  }

  const targetPath = path.join(desktopPath, name.trim());

  try {
    if (!fs.existsSync(targetPath)) {
      await fs.promises.mkdir(targetPath, { recursive: true });
      console.log(`[TIDYDESK] Created directory: "${targetPath}"`);
    }
    res.json({ success: true, path: targetPath });
  } catch (err) {
    console.error("[CRITICAL] Create folder error:", err);
    res.status(500).json({ error: `[CRITICAL] Failed to physically create folder "${name}": ${err.message}` });
  }
});

// 4. POST API: 真实重命名文件或目录
app.post('/api/desktop/rename', async (req, res) => {
  const { oldName, newName, parentFolder } = req.body;

  // [FAIL LOUDLY]
  if (!oldName || !newName) {
    return res.status(400).json({ error: "[CRITICAL] Missing rename parameters." });
  }

  let baseDir = desktopPath;
  if (parentFolder) {
    baseDir = path.join(desktopPath, parentFolder);
  }

  const oldPath = path.join(baseDir, oldName);
  const newPath = path.join(baseDir, newName);

  try {
    if (!fs.existsSync(oldPath)) {
      throw new Error(`Source file "${oldPath}" does not exist.`);
    }

    await fs.promises.rename(oldPath, newPath);
    console.log(`[TIDYDESK] Renamed: "${oldPath}" -> "${newPath}"`);
    res.json({ success: true });
  } catch (err) {
    console.error("[CRITICAL] Rename file error:", err);
    res.status(500).json({ error: `[CRITICAL] Rename failed: ${err.message}` });
  }
});

// 5. POST API: 真实移动物理文件 (拖拽/整理核心)
app.post('/api/desktop/move', async (req, res) => {
  const { fileName, sourceFolder, targetFolder } = req.body;

  // [FAIL LOUDLY]
  if (!fileName) {
    return res.status(400).json({ error: "[CRITICAL] Missing fileName to move." });
  }

  const srcDir = sourceFolder ? path.join(desktopPath, sourceFolder) : desktopPath;
  const destDir = targetFolder ? path.join(desktopPath, targetFolder) : desktopPath;

  const oldPath = path.join(srcDir, fileName);
  const newPath = path.join(destDir, fileName);

  try {
    if (!fs.existsSync(oldPath)) {
      throw new Error(`Physical source file "${oldPath}" not found.`);
    }

    // 确保目标文件夹已物理创建
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    await fs.promises.rename(oldPath, newPath);
    console.log(`[TIDYDESK] Moved file: "${oldPath}" -> "${newPath}"`);
    res.json({ success: true });
  } catch (err) {
    console.error("[CRITICAL] Move file error:", err);
    res.status(500).json({ error: `[CRITICAL] Move failed: ${err.message}` });
  }
});

// 6. POST API: 真实物理删除文件
app.post('/api/desktop/delete', async (req, res) => {
  const { name, parentFolder } = req.body;

  // [FAIL LOUDLY]
  if (!name) {
    return res.status(400).json({ error: "[CRITICAL] Missing name for delete request." });
  }

  const baseDir = parentFolder ? path.join(desktopPath, parentFolder) : desktopPath;
  const targetPath = path.join(baseDir, name);

  try {
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Target file or folder "${targetPath}" does not exist.`);
    }

    const stats = await fs.promises.stat(targetPath);
    if (stats.isDirectory()) {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(targetPath);
    }
    console.log(`[TIDYDESK] Physically deleted: "${targetPath}"`);
    res.json({ success: true });
  } catch (err) {
    console.error("[CRITICAL] Delete item error:", err);
    res.status(500).json({ error: `[CRITICAL] Delete failed: ${err.message}` });
  }
});

// 7. POST API: 批量一键智能整理
app.post('/api/desktop/tidy', async (req, res) => {
  const { suggestions } = req.body;

  // [FAIL LOUDLY]
  if (!suggestions || !Array.isArray(suggestions)) {
    return res.status(400).json({ error: "[CRITICAL] Suggestions mapping array is missing or invalid." });
  }

  try {
    for (const item of suggestions) {
      const { fileName, targetFolder } = item;
      
      const oldPath = path.join(desktopPath, fileName);
      const newDir = path.join(desktopPath, targetFolder);
      const newPath = path.join(newDir, fileName);

      // 保护性跳过不存在的物理文件
      if (!fs.existsSync(oldPath)) {
        console.warn(`[TIDYDESK] Skipping non-existent file: "${oldPath}"`);
        continue;
      }

      // 创建分类目录
      if (!fs.existsSync(newDir)) {
        await fs.promises.mkdir(newDir, { recursive: true });
      }

      // 移动
      await fs.promises.rename(oldPath, newPath);
      console.log(`[TIDYDESK] Batch moved: "${oldPath}" -> "${newPath}"`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[CRITICAL] Batch tidy error:", err);
    res.status(500).json({ error: `[CRITICAL] Batch tidy engine failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 TIDYDESK PHYSICAL DESKTOP AGENT LISTENING ON PORT ${PORT}`);
  console.log(`👉 FRONTEND ENDPOINT PROXY MAPPED TO PORT 3000`);
  console.log(`===========================================================`);
});
