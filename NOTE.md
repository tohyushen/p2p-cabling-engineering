# P2P Skill 功能说明

这个 Skill 用来把设备清单、客户 BOM 和连接规则整理成标准 P2P Excel，也可以检查别人已经做好的 P2P。

它会重点检查：设备名称与机柜/U 位是否一致、每格是否只有一个设备和一个端口、端口是否重复、CAT6/CAT6A/UTP 是否误放模块、光模块与 breakout 是否按物理模块计数、线缆型号长度后缀是否一致，以及 P2P 数量和每个 BOM 长度档是否完全对应。

长度支持两种方式：

- `bom-first`：客户 BOM 数量不变，短路线优先分短线、长路线分长线。
- `calculated`：先算需求长度，再选能覆盖路线的最短 BOM 成品线；不够时直接报错。

使用时先修改 `examples/sample-project.json`，然后运行：

```bash
node scripts/p2p.mjs build --config examples/sample-project.json --output project-p2p.xlsx
node scripts/p2p.mjs audit --input project-p2p.xlsx --report audit.json --markdown audit.md
```

模版和示例全部是虚构资料，可以公开放 GitHub；真实项目数据请另外保存，不要提交到仓库。
