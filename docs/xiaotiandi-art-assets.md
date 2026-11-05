# 小天地美术素材清单

配合 dsh-room-world 插件仓库里的《小天地循环与自主规划方案》（docs/2026-11-05-xiaotiandi-loop-plan.md）。没有素材时程序也能用：面板先用文字和 emoji 占位。素材按批次接入，到一批换一批。

## 通用规格

- 风格：沿用现有的蓝色半立体小屋（`assets/room.png`）和大肥鱼角色图（`assets/idle.png` 等），色调偏蓝、柔和。
- 格式：PNG。物件和角色用透明背景；场景用不透明背景。
- 尺寸：
  - 角色动作图：和现有的一致，约 1240×1270，脚底锚点和 `idle.png` 对齐；
  - 场景：和 `room.png` 一致，1672×941；
  - 图标：256×256，内容居中，四周留 16px 空白；
  - 地块和植物：384×384，底部中心是地面锚点。
- 命名：小写英文加连字符，物种名和插件代码里的 id 一致（dsh-room-world 的 `lib/species.js`），例如 `crop-watermelon-ripe.png`、`fish-koi.png`。
- 存放：放到 `assets/world/`，打包时内嵌，和现有资源一样离线可用。高分辨率原图由作者本地保存，不随仓库分发。
- 权利：沿用 ASSETS.md 的约定。人设相关的图在公开前需要确认授权。

## 第 1 批：面板图标（P0，最先要）

面板的仓库、商店、图鉴页会直接用到。

| 类别 | 文件 | 数量 | 说明 |
|---|---|---|---|
| 货币 | `icon-shell.png` | 1 | 贝壳，浅蓝珠光 |
| 作物果实 | `crop-<id>.png` | 12 | rice 稻米（一捆稻穗）、radish、wheat、tomato、strawberry、pumpkin、watermelon、potato 土豆、corn 玉米、eggplant 茄子、blueberry 蓝莓、grape 葡萄 |
| 花 | `flower-<id>.png` | 7 | daisy、sunflower、tulip、lavender、rose、hydrangea、bluewhale（蓝鲸花：鲸鱼尾形花瓣，专属感） |
| 鱼 | `fish-<id>.png` | 8 | crucian 鲫鱼、crayfish 小龙虾、carp 鲤鱼、goldfish 金鱼、grasscarp 草鱼、catfish 鲶鱼、koi 锦鲤、moonfish 月光鱼（半透明发光） |
| 种子袋 | `seed-<id>.png` | 19 | 每种作物和花各一个纸袋，袋面印小图；也可以只出一个空白袋，程序叠加小图标 |
| 消耗品 | `item-<id>.png` | 9 | rice-bowl 白米饭、bran 米糠、bait 普通鱼饵、bait-pro 高级鱼饵、bait-glow 夜光鱼饵、fishmeal 鱼肥、compost 有机肥、flower-tea 花茶、vase 花瓶 |
| 等级徽章 | `grade-<s|m|l|xl>.png` | 4 | 小、中、大、巨大；「巨大」带闪光 |
| 稀有度 | `rarity-<id>.png` | 4 | 普通、少见、稀有、传说的角标 |
| 未发现 | `codex-unknown.png` | 1 | 图鉴里未发现物种的剪影或问号 |

小计约 69 张。

## 第 2 批：地块与生长阶段（P1）

用在面板地块格里，户外场景也能复用。

| 文件 | 数量 | 说明 |
|---|---|---|
| `plot-soil-dry.png` / `plot-soil-wet.png` | 2 | 农田空地：干的、浇过水的 |
| `bed-soil-dry.png` / `bed-soil-wet.png` | 2 | 花圃空地 |
| `<id>-stage-1.png` 发芽 | 19 | 每个物种一张；同类可以共用一张发芽图，最少 2 张（作物芽、花芽） |
| `<id>-stage-2.png` 成长 | 19 | 每个物种一张 |
| `<id>-stage-3.png` 结果或开花 | 19 | 成熟的样子，可以直接复用第 1 批的图标构图 |
| `overlay-thirsty.png` | 1 | 缺水的小水滴气泡 |
| `overlay-ready.png` | 1 | 可以收获的闪光 |
| `overlay-overripe.png` | 1 | 过熟（轻微发蔫） |
| `overlay-fertilized.png` | 1 | 施过肥的小光点 |
| `pond-idle.png` / `pond-waiting.png` / `pond-bite.png` | 3 | 池塘：水面平静、浮漂等待、浮漂下沉有水花 |

小计约 68 张。如果发芽图共用，可以减到 51 张。

## 第 3 批：小屋里的新东西（P1）

让成果在房间里看得见，叠加在 `room.png` 各时段的图上。

| 文件 | 说明 |
|---|---|
| `room-aquarium.png` | 房间里的鱼缸，空缸。放在现有鱼缸位置或者新增一个位置，需要标出能放鱼的区域坐标 |
| `aquarium-fish-<id>.png` ×8 | 缸里的小鱼，侧身，约 96px，可以做左右游动 |
| `room-vase.png` + `vase-flower-<id>.png` ×7 | 桌上的花瓶和插在瓶里的花 |
| `room-shell-jar.png` | 装贝壳的玻璃罐，可选：分空、半满、满三档 |
| `room-codex-book.png` | 书架上的图鉴册，点击打开图鉴 |
| 各时段光照 | 上面这些物件在黄昏、夜晚各要一版偏色图；也可以由程序统一叠滤镜，就不用单独出图 |

## 第 4 批：角色户外动作（P2）

户外画面做出来时才需要。现在她出门时，房间里显示「出门了」。

| 文件 | 说明 |
|---|---|
| `plant.png` | 蹲下播种 |
| `water-can.png` | 拿着水壶浇水（和房间里照顾绿植的 `water` 区分） |
| `harvest.png` | 抱着刚收的果实或花篮 |
| `fertilize.png` | 撒肥料 |
| `fish-cast.png` / `fish-wait.png` / `fish-reel.png` | 甩竿、坐着等、收竿拉鱼 |
| `fish-show.png` | 举着钓到的鱼，开心 |
| `sell.png` | 在小摊前把东西递出去 |
| `cook.png` | 在电饭煲前盛饭（可以复用 `rice.png` 改动作） |
| `brew.png` | 泡花茶（可以复用 `tea.png`） |
| `cheer-giant.png` | 收到巨大果实或破纪录时欢呼；也可以用现有的 `fish-cheer.gif` 风格做成动图 |

## 第 5 批：户外场景（P2）

| 文件 | 说明 |
|---|---|
| `outdoor-farm-<phase>.png` ×4 | 农场：清晨、白天、黄昏、夜晚。最多 8 块田，标出每块田的锚点坐标 |
| `outdoor-garden-<phase>.png` ×4 | 花园：最多 8 个花圃 |
| `outdoor-pond-<phase>.png` ×4 | 池塘：标出钓鱼位和浮漂位置 |
| `outdoor-shop-<phase>.png` ×4 | 小卖部或集市摊位，用于卖货、买种子 |
| `outdoor-path.png` | 可选：小屋门口通往户外的小路，用来做转场 |

四个场景每个 4 个时段，共 16 张。也可以先只出白天版，其他时段由程序叠色。

## 交付顺序建议

1. 第 1 批的货币、12 种作物、7 种花、8 种鱼图标，加 4 个等级徽章（32 张）：面板马上能用上图。
2. 第 1 批剩下的部分，加第 2 批的池塘 3 张和地块空地 4 张。
3. 第 3 批的鱼缸和花瓶：房间里能看到成果，这一批最有陪伴感。
4. 第 2 批的生长阶段。
5. 第 4、5 批：做户外画面时再出。

## 交付后需要提供给程序的信息

- 鱼缸可游动区域、花瓶位置、贝壳罐位置在 `room.png` 坐标系（百分比）下的位置；
- 户外场景中每块田、每个花圃、钓鱼位、摊位的锚点坐标；
- 角色户外动作图的脚底锚点，如果和 `idle.png` 不一致需要说明。
