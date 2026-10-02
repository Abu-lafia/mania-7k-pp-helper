# mania 7k player pool helper

[English](README.md) | **简体中文**

用于检索 osu!mania 7K 玩家、分析玩家群体及其 BP 谱面的本地网页工具。名称中的“pp”同时代表 **performance points（pp 值）**和 **player pool（玩家群体）**。

## 功能

- 按全球 7K 排名 **1-3,000** 或 **7K pp 2,000 以上**检索玩家。
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
- BP 分析取每位玩家前 50 条 stable/lazer 合并 Mania BP，再筛选原生 7K，并非全部 BP 或游玩历史。公开排行榜仅覆盖前 10,000 名，低 pp 区间可能不完整。
- 理论 pp 按标准化速度档、osu!stable 满分成绩计算；官方 pp 更新后，计算结果可能与官网存在差异。
- 缓存和批量下载文件分别保存在项目内的 `data/`、`downloads/` 文件夹。右上角可切换中英文。
- 项目自带固定版本的 Nunito 字体，保证界面字体一致。Mania Tracker 原版段位图会进行版本校验，并在首次使用时缓存到本机；首次下载需要能够访问 Mania Tracker。

数据来源：[osu!](https://osu.ppy.sh/) · [Mania Tracker](https://mania-tracker.com/?country=GLOBAL)

第三方组件及按需加载的资源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 私用快照与快速结果

搜索会先显示已有数据，后台继续获取当前 BP、段位及计算 PP。相同区间刷新时可立即预览上次完整结果；后台更新会保留表格筛选、排序及下载选择。

可从 [官方数据快照](https://data.ppy.sh/) 下载最新的 `performance_mania_top_10000.tar.bz2`，使用 Python 3 执行：

```sh
python tools/import-snapshot.py data/snapshot/2026_09_01_performance_mania_top_10000.tar.bz2 data/snapshot/snapshot.sqlite
```

仅需导入一次；完整导入后会原子替换数据库，运行中的程序会自动发现首次导入的数据。更换已加载的快照后需重启程序。快照保留样本玩家前 50 条旧版最佳成绩及谱面元数据，不包含独立的 7K 排名表，也不包含最新 lazer 成绩。筛选仍使用 7K 排名；有本地排名缓存时先给出预览，再刷新当前数据。界面标明快照日期，未被快照覆盖的玩家会随后补齐。数据快照的使用须遵守其 [许可](https://data.ppy.sh/LICENCE.txt)。

## 可选配置与验证

复制 `oauth.example.json` 为不会提交到 Git 的 `oauth.local.json`，填入自己的 osu! OAuth 应用 ID 和密钥，即可让 API 和网页分担排名/BP 请求；不配置时继续使用网页方式。`localBeatmapDirectory` 可指定已有 `.osu` 文件目录，文件名使用谱面 ID 或 MD5。

服务器部署时保持程序仅监听回环地址，在自己的 HTTPS 反向代理后使用，并设置 `publicOrigin` 为实际公开地址。代理应传递 `Host: 127.0.0.1:7277`，保留 Origin/Cookie，避免缓存个人/API 响应。托管模式禁用网页关闭服务器按钮。Node 24+ 可在 Linux 运行，`--open` 仅适用于 Windows。

匿名浏览器 Cookie 隔离搜索任务、上次结果及下载队列，IndexedDB 保存本机浏览器结果，公共计算缓存仍共享。换浏览器或清除网站数据会成为新访客，不提供跨设备账户同步。旧的全局结果不会自动分配给新访客。

运行 `npm test` 和 `python tools/snapshot-check.py` 可执行离线回归检查，无需凭据或网络。
