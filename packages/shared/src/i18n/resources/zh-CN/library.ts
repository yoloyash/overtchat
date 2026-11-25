import type { Translation } from "../../catalog";

export const library: Translation["library"] = {
  browser: {
    search: "搜索资料库",
    viewLabel: "资料库视图",
    listView: "列表视图",
    gridView: "网格视图",
    loading: "正在加载资料库…",
    loadError: "无法加载你的资料库。",
    refreshError: "无法刷新你的资料库。",
    tryAgain: "重试",
    emptySearchTitle: "没有匹配的文件",
    emptyTitle: "你的资料库为空",
    emptySearchDescription: "请尝试其他文件名。",
    emptyDescription: "你在已保存对话中附加的文件会显示在这里，方便再次使用。",
    filesLabel: "资料库文件",
    alreadyAttached: "已附加",
    openFile: "打开 {{filename}}",
    loadingMore: "正在加载…",
    loadMore: "加载更多",
  },
  picker: {
    title: "从资料库添加",
    closeLabel: "关闭资料库",
    description: "从已保存的对话中选择文件。",
    selectedCount_other: "已选择 {{count}} 项",
    addFilesEmpty: "添加文件",
    addFiles_other: "添加 {{count}} 个文件",
  },
};
