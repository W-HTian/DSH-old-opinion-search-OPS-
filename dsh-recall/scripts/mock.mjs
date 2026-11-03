// Layout smoke test: render a static mock of the Recall panel with the real CSS
// string from lib/client.js, so the panel's visual structure can be inspected
// outside the app (headless Chrome screenshot).
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')

let captured
const sandbox = {
	window: {
		__ModuleLoader__: { load: (mod) => { captured = mod } },
		addEventListener() {}
	},
	console
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox)
const mod = captured.factory(() => ({}))
const css = mod.__css
if (!css) throw new Error('CSS export missing')

const hits = [
	{ kind: 'user', text: '我有一篇毕业论文想复现 U-Net 的分割结果，数据集是 ISIC 2018，先把训练脚本跑通。', time: '15:04', type: '我的消息' },
	{ kind: 'assistant', text: '先看一下数据集目录结构，然后写一个最小训练循环：U-Net 编码器 4 层下采样，BCE + Dice 损失，Adam lr=1e-4，batch 8。', time: '15:06', type: 'AI 回复' },
	{ kind: 'tool', text: 'python train.py --config configs/unet_isic.yaml --epochs 30 --batch-size 8', time: '15:07', type: '工具调用' }
]

const row = (hit) => `
	<div class="dshr-hit" data-sel="${hit.selected ? '1' : '0'}">
		<span class="dshr-badge" data-kind="${hit.kind}">${hit.kind === 'user' ? '我' : hit.kind === 'assistant' ? 'AI' : '工具'}</span>
		<div class="dshr-hitbody">
			<div class="dshr-snippet">${hit.text.replace('U-Net', '<mark class="dshr-mark">U-Net</mark>')}</div>
			<div class="dshr-hitline"><span>${hit.time}</span><span>${hit.type}</span></div>
		</div>
	</div>`

const group = (title, project, meta) => `
	<div class="dshr-group">
		<div class="dshr-grouphead">
			<span class="dshr-gtitle">${title}</span>
			<span class="dshr-gmeta">${project} · ${meta}</span>
			<button class="dshr-gopen">打开会话</button>
		</div>
		${hits.map((hit, index) => row({ ...hit, selected: index === 1 })).join('')}
	</div>`

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{
  --dsw-alias-bg-base:#141414;--dsw-alias-bg-layer-1:#1c1c1e;--dsw-alias-bg-layer-2:#26262a;
  --dsw-alias-label-primary:#ececec;--dsw-alias-label-secondary:#9aa0a6;
  --dsw-alias-border-l1:#2c2c30;--dsw-alias-border-l2:#3a3a40;--dsw-alias-brand-primary:#4f8cff;
}
html,body{height:100%;margin:0;background:#0f0f10;font-family:"Microsoft YaHei UI","Segoe UI",sans-serif}
.panel{height:820px;width:1160px;display:flex;background:var(--dsw-alias-bg-base)}
${css}
</style></head>
<body><div class="panel"><div class="dshr-root">
	<div class="dshr-head">
		<div class="dshr-titlebar">
			<span class="dshr-title">全局搜索</span>
			<span class="dshr-sub">跨项目搜索历史对话里做过的事</span>
			<span style="flex:1"></span>
			<span class="dshr-sub">31 会话 / 3296 条</span>
			<button class="dshr-ghost">刷新索引</button>
		</div>
		<div class="dshr-searchrow">
			<div class="dshr-search">
				<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.4"/><path d="M10.6 10.6 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
				<input class="dshr-input" value="U-Net" />
				<span class="dshr-kbd">Ctrl+Shift+F</span>
			</div>
		</div>
		<div class="dshr-filters">
			<select class="dshr-select"><option>全部项目</option></select>
			<button class="dshr-ghost" data-on="0">全部时间</button>
			<button class="dshr-ghost" data-on="1">近 7 天</button>
			<button class="dshr-ghost" data-on="0">近 30 天</button>
			<button class="dshr-ghost" data-on="0">近一年</button>
		</div>
	</div>
	<div class="dshr-body">
		<div class="dshr-list">
			<div class="dshr-status"><span>命中 85 条 · 会话 4 个</span><span>2ms</span></div>
			${group('复现 U-Net 毕业论文实验（ISIC 2018 分割）', '毕业论文-U-Net', '2 小时前')}
			${group('修一下训练时 loss 不下降的问题', 'dart-aie', '3 天前')}
		</div>
		<div class="dshr-detail">
			<div class="dshr-dhead">
				<div class="dshr-dtitle">复现 U-Net 毕业论文实验（ISIC 2018 分割）</div>
				<div class="dshr-dmeta"><span>毕业论文-U-Net</span><span>2 小时前</span></div>
			</div>
			<div class="dshr-dbody">
				<div class="dshr-ev"><div class="dshr-evhead"><span>我</span><span>15:04</span></div>先看一下数据集目录结构。</div>
				<div class="dshr-ev" data-focus="1"><div class="dshr-evhead"><span>AI</span><span>15:06</span><span class="dshr-mark" style="padding:0 4px">命中</span></div>我建议先把 U-Net 的编码器改成 4 层下采样，损失用 BCE + Dice，学习率 1e-4，batch size 8 先跑通一个 epoch。</div>
				<div class="dshr-ev"><div class="dshr-evhead"><span>工具</span><span>15:07</span></div>python train.py --config configs/unet_isic.yaml</div>
			</div>
			<div class="dshr-dactions">
				<button class="dshr-btn" data-primary="1">在会话中打开</button>
				<button class="dshr-btn">复制命中内容</button>
			</div>
		</div>
	</div>
</div></div></body></html>`

fs.writeFileSync(path.join(root, 'mock.html'), html)
fs.writeFileSync(path.join(root, 'mock.css'), css)
console.log('mock written', html.length)
