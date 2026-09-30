# mania 7k player pool helper

[English](README.md) | **简体中文**

用于检索 osu!mania 7K 玩家、分析玩家群体及其 BP 谱面的本地网页工具。名称中的“pp”同时代表 **performance points（pp 值）**和 **player pool（玩家群体）**。

## 功能

- 按全球 7K 排名 **1-3,000** 或 **7K pp 6,000 以上**检索玩家。
- 通过交互式直方图查看 pp、常规段位和 LN 段位分布，玩家列表支持搜索和排序。
- 只统计**原生 7K mania 谱面**，排除标准模式转谱。
- 按 **HT / 原速 / DT-NC** 区分谱面条目，其他 mod 不单独拆分。
- 查看计算得到的理论满分 pp、星级，以及按不同玩家人数统计的谱面出现频率。
- 提供 osu! 和小夜镜像站的无视频下载链接，并支持通过小夜镜像站批量下载。

## 快速开始

需要 **Windows、Node.js 24 或更高版本，以及网络连接**。

下载并解压本仓库，在项目文件夹中打开 PowerShell，依次运行：

```powershell
npm.cmd install
Copy-Item config.example.json config.json
npm.cmd start -- --open
```

程序会在默认浏览器中打开。选择检索方式、设置范围，然后开始检索。默认地址为 [127.0.0.1:7277](http://127.0.0.1:7277/)；若使用其他端口，以终端显示的地址为准。

## 注意事项

- 首次检索较大玩家群体可能耗时较长，重复检索可利用缓存加速。
- BP 分析基于 osu! 可获取的最佳表现列表，并非玩家全部游玩历史。公开排行榜的范围限制可能影响 pp 区间检索的覆盖率。
- 理论 pp 按标准化速度档、osu!stable 满分成绩计算；官方 pp 更新后，计算结果可能与官网存在差异。
- 缓存和批量下载文件分别保存在项目内的 `data/`、`downloads/` 文件夹。程序界面目前仅支持英文。
- 项目自带固定版本的 Nunito 字体，保证界面字体一致。Mania Tracker 原版段位图会进行版本校验，并在首次使用时缓存到本机；首次下载需要能够访问 Mania Tracker。

数据来源：[osu!](https://osu.ppy.sh/) · [Mania Tracker](https://mania-tracker.com/?country=GLOBAL)

第三方组件及按需加载的资源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
