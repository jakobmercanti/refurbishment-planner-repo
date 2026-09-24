"""Create catalogue illustrations and architectural plan symbols for room fixtures."""
from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[1] / "frontend/public"


def save(key, plan, preview):
    for directory, content in [("fixture-symbols", plan), ("fixture-previews", preview)]:
        (PUBLIC / directory / f"{key}.svg").write_text(content, encoding="utf8")


for style in ("single", "double", "glass-single", "glass-double", "open", "bridge"):
    key = f"furniture-kitchen-cabinet-{style}"
    count = 2 if "double" in style else 1
    plan = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><title>Upper cabinet: dashed outline above plan cut</title><g fill="none" stroke="#293538" stroke-width="2" stroke-dasharray="8 5"><rect x="4" y="4" width="292" height="92"/>'
    if count == 2:
        plan += '<path d="M150 4 V96"/>'
    plan += '</g></svg>'
    h = 115 if style == "bridge" else 220
    w = 240 if count == 2 or style == "bridge" else 165
    x, y = (300-w)/2, (270-h)/2
    fronts = ''
    for i in range(count):
        px, pw = x+i*w/count, w/count
        fronts += f'<rect x="{px+3}" y="{y+3}" width="{pw-6}" height="{h-6}" rx="2" fill="url(#paint)" stroke="#a9b1ad"/>'
        if "glass" in style or style == "open":
            fronts += f'<rect x="{px+14}" y="{y+14}" width="{pw-28}" height="{h-28}" fill="#d9e4e1" stroke="#9ba6a4"/>'
            fronts += ''.join(f'<path d="M{px+15} {y+h*t} h{pw-30}" stroke="#8b9794" stroke-width="4"/>' for t in (.33,.66))
            if "glass" in style:
                fronts += f'<path d="M{px+18} {y+h-20} L{px+pw-18} {y+20}" stroke="white" stroke-width="5" opacity=".5"/>'
        if style != "open":
            fronts += f'<rect x="{px+pw-19}" y="{y+h-53}" width="4" height="31" rx="2" fill="#778581"/>'
    preview = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 290"><defs><linearGradient id="paint"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#dbded9"/></linearGradient></defs><rect width="320" height="290" fill="#edf1ee"/><path d="M{x+w} {y} l22 -12 v{h} l-22 12Z" fill="#aeb9b3"/><path d="M{x} {y} l22 -12 h{w} l-22 12Z" fill="#e1e7e1"/>{fronts}</svg>'
    save(key, plan, preview)

for style in ("oval", "slipper", "alcove", "corner"):
    key = f"furniture-bath-{style}"
    outer = '<rect x="4" y="4" width="292" height="142" rx="3"/>' if style == "alcove" else '<path d="M4 4 H296 V45 Q296 146 175 146 H4Z"/>' if style == "corner" else '<ellipse cx="150" cy="75" rx="145" ry="70"/>'
    plan = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><title>{style} bath plan</title><g fill="white" stroke="#293538" stroke-width="2">{outer}<ellipse cx="150" cy="75" rx="125" ry="53"/><ellipse cx="150" cy="75" rx="95" ry="32" fill="none"/><circle cx="235" cy="75" r="4"/><path d="M130 5 V22 H150 V35 M116 14 h8 M160 14 h8" fill="none"/></g></svg>'
    feet = '<path d="M85 183 l-8 29 M226 179 l8 28" stroke="#8b9698" stroke-width="11"/>' if style == "slipper" else ''
    body = '<path d="M32 92 Q20 194 105 207 L238 185 Q275 154 280 91Z" fill="url(#body)" stroke="#b8c3c4"/>'
    if style == "alcove":
        body = '<path d="M25 92 L45 199 L266 183 L284 85Z" fill="url(#body)" stroke="#b8c3c4"/>'
    if style == "corner":
        body = '<path d="M25 92 L27 186 Q175 230 280 151 V82Z" fill="url(#body)" stroke="#b8c3c4"/>'
    preview = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 260"><defs><linearGradient id="body"><stop stop-color="#c4d0d0"/><stop offset=".4" stop-color="#ffffff"/><stop offset="1" stop-color="#e7ebea"/></linearGradient><radialGradient id="inside"><stop stop-color="#ccd7d7"/><stop offset="1" stop-color="#fafffd"/></radialGradient></defs><rect width="320" height="260" fill="#edf1ee"/><ellipse cx="160" cy="215" rx="123" ry="13" fill="#dce3df"/>{feet}{body}<ellipse cx="155" cy="90" rx="129" ry="52" fill="#ffffff" stroke="#bcc9c8"/><ellipse cx="155" cy="90" rx="113" ry="41" fill="url(#inside)" stroke="#d9e2e0"/><ellipse cx="207" cy="99" rx="6" ry="3" fill="#83928f"/><path d="M150 52 v-23 q0 -15 16 -15 h10 v21" fill="none" stroke="#8d9c9d" stroke-width="6"/></svg>'
    save(key, plan, preview)
