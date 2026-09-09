import json, re, datetime

SRC = r"C:\Users\Dieter Stubler\.claude\projects\c--msys64-home-Dieter-Prospector\ea0f2dbd-f6a9-4610-ab12-51bc118a7fde.jsonl"
OUT = r"c:\msys64\home\Dieter\Prospector\session-transcript.md"
MAX_RESULT = 1400

def clean(t):
    t = re.sub(r"<system-reminder>.*?</system-reminder>", "", t, flags=re.S)
    return t.strip()

def ts(s):
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return s

def quote(label, text):
    text = clean(text)
    if len(text) > MAX_RESULT:
        text = text[:MAX_RESULT] + "\n… [truncated]"
    if not text:
        return []
    out = [f"> **{label}**", ">"]
    out += ["> " + ln for ln in text.splitlines()]
    out.append("")
    return out

rows = []
with open(SRC, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("type") not in ("user", "assistant"):
            continue
        msg = o.get("message")
        if not isinstance(msg, dict):
            continue
        origin = o.get("origin") or {}
        kind = origin.get("kind") if isinstance(origin, dict) else None
        content = msg.get("content")
        parts = []
        if isinstance(content, str):
            parts.append(("text", content))
        elif isinstance(content, list):
            for b in content:
                if not isinstance(b, dict):
                    continue
                bt = b.get("type")
                if bt == "text":
                    parts.append(("text", b.get("text", "")))
                elif bt == "thinking":
                    parts.append(("thinking", b.get("thinking", "")))
                elif bt == "tool_use":
                    parts.append(("tool_use", (b.get("name", "?"), b.get("input", {}))))
                elif bt == "tool_result":
                    c = b.get("content", "")
                    if isinstance(c, list):
                        c = "\n".join(x.get("text", "[non-text content]") if isinstance(x, dict) else str(x) for x in c)
                    parts.append(("tool_result", str(c)))
        rows.append((msg.get("role"), kind, o.get("timestamp", ""), parts))

md = [
    "# Prospector — Session Transcript",
    "",
    "Working session on reviving the *Prospector* board game as a web application: "
    "OCR feasibility, an English rules translation, and project planning.",
    "",
]
if rows:
    md.append(f"**Session:** `ea0f2dbd` · **Start:** {ts(rows[0][2])} · **End:** {ts(rows[-1][2])}")
md += ["", "*Thinking blocks and injected skill instructions are omitted. Tool calls are "
       "summarised; long tool output is truncated.*", "", "---", ""]

user_turns = 0
last_header = None  # "user" | "claude" | None

for role, kind, t, parts in rows:
    texts = [p for k, p in parts if k == "text" and clean(p)]
    tool_calls = [p for k, p in parts if k == "tool_use"]
    tool_results = [p for k, p in parts if k == "tool_result"]

    if role == "user":
        if tool_results and not texts:
            for r in tool_results:
                md += quote("tool result", r)
            continue
        if kind == "task-notification":
            for p in texts:
                md += quote("background notification", p)
            last_header = None
            continue
        if kind != "human":
            # injected skill / system content
            md += ["> _(skill instructions injected here — omitted)_", ""]
            continue
        user_turns += 1
        md += ["## User", ""]
        for p in texts:
            md.append(clean(p))
        md.append("")
        last_header = "user"
        continue

    # assistant
    body = []
    for k, p in parts:
        if k == "text":
            c = clean(p)
            if c:
                body += [c, ""]
        elif k == "tool_use":
            name, inp = p
            summ = ""
            for key in ("command", "file_path", "pattern", "prompt", "description", "skill", "url", "action", "args"):
                if isinstance(inp, dict) and isinstance(inp.get(key), str) and inp[key].strip():
                    summ = inp[key].splitlines()[0][:150]
                    break
            body += [f"*→ {name}*" + (f" — `{summ}`" if summ else ""), ""]
    if not body:
        continue
    if last_header != "claude":
        md += ["## Claude", ""]
    md += body
    last_header = "claude"

out = re.sub(r"\n{3,}", "\n\n", "\n".join(md)).rstrip() + "\n"
with open(OUT, "w", encoding="utf-8") as f:
    f.write(out)
print("wrote", OUT, "-", len(out), "chars,", user_turns, "user turns")
