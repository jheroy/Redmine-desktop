# Redmine-Desktop 开发记录 (AGENTS.md)

本项目是一个跨平台的 Redmine 客户端，旨在提供流畅、美观且高效的任务管理体验。本项目由旧版的 Swift/SwiftUI 版本迁移至目前的 Electron + React + Vite 架构。

## 技术栈
- **核心**: Electron, React (Functional Components + Hooks)
- **状态管理**: 自定义 `useAppViewModel` (响应式状态管理)
- **构建工具**: Vite, TypeScript
- **打包**: electron-builder
- **样式**: Vanilla CSS (注重性能与 GPU 加速)

## 开发里程碑与历史

### v1.0.0 - v1.0.3: 基础构建与性能奠基
- **核心逻辑迁移**: 从原生 Swift 逻辑完整迁移至 TypeScript 驱动的服务层。
- **性能优化**:
    - 引入 `content-visibility: auto` 优化长列表渲染。
    - 使用 `transform` 替代 `top/left` 实现选择指示器的 GPU 加速动画。
    - 实现 `AuthenticatedImage` 缓存机制，减少冗余 API 请求。
- **UI 增强**:
    - 实现侧边栏项目/版本列表的平滑滑动指示器。
    - 支持可调节宽度的响应式面板（Sidebar & Issue List Ratio）。
    - 增加顶部标题栏拖动区域。

### v1.0.4: 分组与过滤器增强
- **任务分组**: 增加“按状态”和“按人员”分组切换功能。
- **动态过滤器**: 过滤器选项根据分组模式动态调整（如：按状态分组时显示指派人过滤器）。
- **同步指示器**: 修复了窗口缩放时选择指示器位置不更新的 Bug。

### v1.0.5 - v1.0.7: 视觉特效 (Transparency & Vibrancy)
- **macOS Vibrancy**: 引入原生毛玻璃效果 (`vibrancy: 'under-window'`)。
- **玻璃态 UI**: 优化透明模式下的 `issue-item` 背景，使其呈现更通透的 Glassmorphism 效果。
- **Light 模式优化**: 针对浅色模式的透明效果进行深度调优，降低灰蒙蒙的感官，提升通透度。

### v1.0.8 (Current): 稳定性与主题适配
- **策略调整**: 考虑到浅色模式毛玻璃效果的局限性，决定在 **Light 模式下自动禁用透明效果**，保持稳定一致的纯色背景。
- **工程化**: 完善 `.gitignore` 文件，过滤不必要的二进制与构建产物。

## 关键技术细节 (供 Agent 参考)

### 1. 指示器同步逻辑
由于窗口缩放、文字折行会导致元素高度瞬间跳变，指示器的更新采用了多帧同步策略：
```typescript
const sync = () => {
    update(); // 计算元素位置并 setStyle
    if (count < 15) { // 持续同步 15 帧确保稳定
        count++;
        rafId = requestAnimationFrame(sync);
    }
};
```

### 2. 状态管理 (ViewModel)
所有业务逻辑封装在 `src/renderer/hooks/useAppViewModel.ts`。UI 通过 `vm` 访问数据和方法。
- 关键状态：`selectedProjectId`, `selectedVersionId`, `groupedIssues` (带缓存)。

### 3. 透明模式控制
透明模式依赖 `localStorage.getItem('enableTransparency')` 和 `isMac` 环境。
CSS 类名控制：`.transparency-enabled` (仅在 Dark 模式有效)。

## 待办事项 / 未来优化
- [ ] 增加更多自定义过滤条件。
- [ ] 优化离线存储机制。
- [ ] Windows 平台的 Acrylic/Mica 特效探索 (类似 macOS 的模糊效果)。
