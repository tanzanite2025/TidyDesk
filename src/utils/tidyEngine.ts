import { TidyFile, FileCategory, DesktopHealthInfo } from '../types/file';

/**
 * 依据后缀智能判定文件类别
 */
export function getCategoryByExtension(ext: string, fileName: string): FileCategory {
  const nameLower = fileName.toLowerCase();
  const extLower = ext.toLowerCase().replace('.', '');

  // [FAIL LOUDLY] 防静默失效：如果文件名完全为空，强制抛出错误
  if (!fileName) {
    throw new Error("[CRITICAL] getCategoryByExtension received an empty fileName. Fatal input validation failure.");
  }

  // 临时文件标记
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

  const documents = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'csv', 'md', 'pdf', 'key', 'numbers', 'pages'];
  if (documents.includes(extLower)) return 'document';

  const archives = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  if (archives.includes(extLower)) return 'archive';

  const apps = ['exe', 'msi', 'bat', 'cmd', 'dmg', 'pkg'];
  if (apps.includes(extLower)) return 'app';

  const developer = ['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'py', 'go', 'rs', 'cpp', 'h', 'java', 'sh', 'yaml', 'yml'];
  if (developer.includes(extLower)) return 'developer';

  return 'other';
}

/**
 * 产生初始模拟桌面乱套文件集
 */
export function generateSimulatedFiles(): TidyFile[] {
  const filesData: Omit<TidyFile, 'parentId' | 'category' | 'path'>[] = [
    // 垃圾/临时文件 (Temporary)
    { id: 'sim-1', name: '新建文本文档.txt', size: 0, extension: '.txt', modifiedAt: new Date(Date.now() - 3600000 * 2).toISOString(), isSimulated: true },
    { id: 'sim-2', name: '新建文件夹 (2).zip', size: 1024 * 50, extension: '.zip', modifiedAt: new Date(Date.now() - 3600000 * 5).toISOString(), isSimulated: true },
    { id: 'sim-3', name: 'Screenshot_2026-05-12_102030.png', size: 1024 * 850, extension: '.png', modifiedAt: new Date(Date.now() - 86400000 * 11).toISOString(), isSimulated: true },
    { id: 'sim-4', name: 'temp_data_export.xlsx', size: 1024 * 410, extension: '.xlsx', modifiedAt: new Date(Date.now() - 3600000 * 1).toISOString(), isSimulated: true },
    { id: 'sim-5', name: 'untitled_draft.docx', size: 1024 * 20, extension: '.docx', modifiedAt: new Date(Date.now() - 86400000 * 25).toISOString(), isSimulated: true },
    
    // 大文件 (Large Files & Documents)
    { id: 'sim-6', name: '2025_Annual_Report_Final_V3_Confirmed.pdf', size: 1024 * 1024 * 12, extension: '.pdf', modifiedAt: new Date(Date.now() - 86400000 * 120).toISOString(), isSimulated: true },
    { id: 'sim-7', name: 'Big_Dataset_ML_Model.tar.gz', size: 1024 * 1024 * 345, extension: '.tar.gz', modifiedAt: new Date(Date.now() - 86400000 * 45).toISOString(), isSimulated: true },
    
    // 各种图片 (Images)
    { id: 'sim-8', name: 'avatar_designer_pro.webp', size: 1024 * 15, extension: '.webp', modifiedAt: new Date(Date.now() - 86400000 * 4).toISOString(), isSimulated: true },
    { id: 'sim-9', name: 'workspace_setup_photo.jpeg', size: 1024 * 1024 * 4.2, extension: '.jpeg', modifiedAt: new Date(Date.now() - 86400000 * 8).toISOString(), isSimulated: true },
    { id: 'sim-10', name: 'ui_mockup_v1_0.png', size: 1024 * 1024 * 2.8, extension: '.png', modifiedAt: new Date(Date.now() - 86400000 * 1).toISOString(), isSimulated: true },
    
    // 安装包与程序 (Apps)
    { id: 'sim-11', name: 'VSCodeUserSetup-x64-1.92.0.exe', size: 1024 * 1024 * 92, extension: '.exe', modifiedAt: new Date(Date.now() - 86400000 * 14).toISOString(), isSimulated: true },
    { id: 'sim-12', name: 'node-v20.11.0-x64.msi', size: 1024 * 1024 * 29, extension: '.msi', modifiedAt: new Date(Date.now() - 86400000 * 60).toISOString(), isSimulated: true },
    
    // 开发文件 (Developer)
    { id: 'sim-13', name: 'index.tsx', size: 1024 * 4.5, extension: '.tsx', modifiedAt: new Date(Date.now() - 3600000 * 3).toISOString(), isSimulated: true },
    { id: 'sim-14', name: 'App.css', size: 1024 * 2, extension: '.css', modifiedAt: new Date(Date.now() - 3600000 * 4).toISOString(), isSimulated: true },
    { id: 'sim-15', name: 'package-lock.json', size: 1024 * 840, extension: '.json', modifiedAt: new Date(Date.now() - 86400000 * 3).toISOString(), isSimulated: true },
    { id: 'sim-16', name: 'main.go', size: 1024 * 12, extension: '.go', modifiedAt: new Date(Date.now() - 86400000 * 180).toISOString(), isSimulated: true }
  ];

  return filesData.map(f => {
    // 触发安全检查
    if (!f.id || !f.name) {
      throw new Error(`[CRITICAL] Bad simulated item metadata. Name or ID is missing. ID: ${f.id}`);
    }
    // 使用跨平台路径构建
    const desktopPath = 'C:\\Users\\User\\Desktop';
    return {
      ...f,
      parentId: null,
      path: `${desktopPath}\\${f.name}`,
      category: getCategoryByExtension(f.extension, f.name)
    };
  });
}

/**
 * 计算桌面健康度评分
 */
export function calculateDesktopHealth(files: TidyFile[], folderCount: number): DesktopHealthInfo {
  // [FAIL LOUDLY] 如果文件数组为 null 或 undefined，强行阻断
  if (!files) {
    throw new Error("[CRITICAL] calculateDesktopHealth was invoked with a null/undefined files collection.");
  }

  // 仅仅统计直接放在桌面根目录的文件（parentId 为 null 的文件）进行健康评分
  const rootFiles = files.filter(f => f.parentId === null);
  const totalFiles = rootFiles.length;
  const totalSize = rootFiles.reduce((acc, f) => acc + f.size, 0);

  // 1. 初始满分 100
  let score = 100;

  // 2. 根目录文件数量惩罚：桌面直接放超过 5 个文件，每多一个扣 3 分
  if (totalFiles > 5) {
    score -= (totalFiles - 5) * 3;
  }

  // 3. 临时未命名文件惩罚：每多一个扣 6 分
  const tempFiles = rootFiles.filter(f => f.category === 'temporary');
  const tempFileCount = tempFiles.length;
  score -= tempFileCount * 6;

  // 4. 大文件惩罚 (> 100MB)：每多一个扣 8 分（建议移出桌面释放C盘）
  const largeFiles = rootFiles.filter(f => f.size > 1024 * 1024 * 100);
  const largeFileCount = largeFiles.length;
  score -= largeFileCount * 8;

  // 5. 过期陈旧文件惩罚 (超过 60 天未修改)：每多一个扣 2 分
  const sixtyDaysAgo = Date.now() - 86400000 * 60;
  const oldFiles = rootFiles.filter(f => new Date(f.modifiedAt).getTime() < sixtyDaysAgo);
  score -= oldFiles.length * 2;

  // 限制得分在 [0, 100] 之间
  score = Math.max(0, Math.min(100, score));

  // 决定健康状态
  let status: 'HEALTHY' | 'ALERT' | 'CRITICAL' = 'HEALTHY';
  let suggestion = '桌面井然有序，保持极佳的工作效率！';

  if (score < 60) {
    status = 'CRITICAL';
    suggestion = `🚨 桌面环境告急！当前存在 ${totalFiles} 个散乱文件，其中 ${tempFileCount} 个是临时垃圾。大文件占用 C 盘，建议启动「一键智能整理」！`;
  } else if (score < 85) {
    status = 'ALERT';
    suggestion = `⚠️ 桌面文件有些杂乱（健康度 ${score}%）。建议对其中的开发代码或大安装包进行归纳整理。`;
  }

  return {
    score,
    totalFiles,
    totalFolders: folderCount,
    totalSize,
    tempFileCount,
    largeFileCount,
    suggestion,
    status
  };
}

/**
 * 智能整理预览模型
 */
export interface TidySuggestionItem {
  fileId: string;
  fileName: string;
  sourcePath: string;
  targetFolder: string;
  action: 'MOVE' | 'ISOLATE';
}

/**
 * 依据选定规则规划整理提案
 */
export function proposeTidyActions(
  files: TidyFile[], 
  rule: 'category' | 'date' | 'temp'
): TidySuggestionItem[] {
  // [FAIL LOUDLY]
  if (!files) {
    throw new Error("[CRITICAL] proposeTidyActions received a null/undefined files collection.");
  }

  // 仅仅整理放在桌面根目录的文件
  const rootFiles = files.filter(f => f.parentId === null);

  return rootFiles.map(f => {
    let targetFolder = '其他文件';
    let action: 'MOVE' | 'ISOLATE' = 'MOVE';

    if (rule === 'category') {
      switch (f.category) {
        case 'image':
          targetFolder = '桌面图片';
          break;
        case 'document':
          targetFolder = '桌面文档';
          break;
        case 'archive':
          targetFolder = '归档压缩包';
          break;
        case 'app':
          targetFolder = '应用程序安装包';
          break;
        case 'developer':
          targetFolder = '开发者项目文件';
          break;
        case 'temporary':
          targetFolder = '临时待清理隔离区';
          action = 'ISOLATE';
          break;
        default:
          targetFolder = '未分类归属区';
      }
    } else if (rule === 'date') {
      const modifiedTime = new Date(f.modifiedAt).getTime();
      const now = Date.now();
      const oneDay = 86400000;

      if (now - modifiedTime < oneDay) {
        targetFolder = '今日整理 (Today)';
      } else if (now - modifiedTime < oneDay * 7) {
        targetFolder = '本周整理 (This Week)';
      } else if (now - modifiedTime < oneDay * 30) {
        targetFolder = '本月整理 (This Month)';
      } else {
        targetFolder = '更早陈旧文件 (Earlier)';
      }
    } else if (rule === 'temp') {
      // 仅隔离临时临时垃圾，其它文件不做处理
      if (f.category === 'temporary') {
        targetFolder = '临时文件堆放区 (Temp隔離)';
        action = 'ISOLATE';
      } else {
        // 返回特殊占位表示不参与整理
        targetFolder = ''; 
      }
    }

    return {
      fileId: f.id,
      fileName: f.name,
      sourcePath: f.path,
      targetFolder,
      action
    };
  }).filter(item => item.targetFolder !== ''); // 剔除不移动的项目
}
