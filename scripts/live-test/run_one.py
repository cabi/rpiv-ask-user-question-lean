#!/usr/bin/env python3
"""Run one pi RPC session against a fixture project and log everything.

Spawns `pi --mode rpc --no-session --no-extensions -e <ext>` in a fresh copy
of the fixture, sends one prompt, auto-answers every extension UI dialog
(select -> second option, input -> "you decide", confirm -> yes), waits for
agent_settled, and writes the raw event stream plus a summary JSON.

With --early-stop the run is scored and killed at the model's first
committing move: ask_user_question fires -> "asked"; an edit/write tool
fires -> "committed"; agent_settled without either -> "settled". Reads and
bash exploration do not stop the run.

Usage:
  run_one.py --ext <extension-entry.ts> --prompt "..." --out <events.jsonl>
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

PI_BIN = os.environ.get("PI_BIN", "/home/carsten/.pi/agent/bin/pi")


def send(proc, lock, record):
    with lock:
        proc.stdin.write((json.dumps(record) + "\n").encode("utf-8"))
        proc.stdin.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ext", required=True, help="extension entry file to load via -e")
    ap.add_argument("--fixture", required=True, help="fixture dir to copy")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True, help="path for the event log (jsonl)")
    ap.add_argument("--summary", required=True, help="path for the summary json")
    ap.add_argument("--timeout", type=float, default=420.0)
    ap.add_argument("--early-stop", action="store_true",
                    help="kill the run at the first ask_user_question or edit/write call")
    args = ap.parse_args()

    workdir = tempfile.mkdtemp(prefix="pi-live-")
    for item in os.listdir(args.fixture):
        src = os.path.join(args.fixture, item)
        dst = os.path.join(workdir, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    errfile = args.out + ".stderr"
    proc = subprocess.Popen(
        [PI_BIN, "--mode", "rpc", "--no-session", "--no-extensions",
         "-e", os.path.abspath(args.ext)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=open(errfile, "wb"),
        cwd=workdir,
    )

    lock = threading.Lock()
    events = []
    state = {
        "ask_calls": 0,
        "tool_calls": {},
        "dialogs": [],
        "assistant_text": "",
        "stop_reason": None,
        "ask_result_texts": [],
    }
    IMPL_TOOLS = {"edit", "write", "hashline", "replace"}
    settled = threading.Event()

    def reader():
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                events.append({"type": "_unparsed", "raw": line.decode("utf-8", "replace")})
                continue
            events.append(rec)
            t = rec.get("type")
            if t == "extension_ui_request":
                method = rec.get("method")
                rid = rec.get("id")
                state["dialogs"].append(method)
                if method == "select":
                    opts = rec.get("options") or []
                    if opts:
                        val = opts[1] if len(opts) > 1 else opts[0]
                        send(proc, lock, {"type": "extension_ui_response", "id": rid, "value": val})
                    else:
                        send(proc, lock, {"type": "extension_ui_response", "id": rid, "cancelled": True})
                elif method == "input":
                    send(proc, lock, {"type": "extension_ui_response", "id": rid, "value": "you decide"})
                elif method == "confirm":
                    send(proc, lock, {"type": "extension_ui_response", "id": rid, "confirmed": True})
                # notify/setStatus/... are fire-and-forget
            elif t == "tool_execution_start":
                name = rec.get("toolName", "?")
                state["tool_calls"][name] = state["tool_calls"].get(name, 0) + 1
                if name == "ask_user_question":
                    state["ask_calls"] += 1
                    if args.early_stop and state["stop_reason"] is None:
                        state["stop_reason"] = "asked"
                        settled.set()
                elif (args.early_stop and name in IMPL_TOOLS
                      and state["stop_reason"] is None):
                    state["stop_reason"] = "committed"
                    settled.set()
            elif t == "tool_execution_end":
                if rec.get("toolName") == "ask_user_question":
                    for block in (rec.get("result") or {}).get("content", []):
                        if block.get("type") == "text":
                            state["ask_result_texts"].append(block.get("text", "")[:400])
            elif t == "message_update":
                upd = rec.get("assistantMessageEvent") or {}
                if upd.get("type") == "text_delta":
                    state["assistant_text"] += upd.get("delta", "")
            elif t == "agent_settled":
                if state["stop_reason"] is None:
                    state["stop_reason"] = "settled"
                settled.set()

    t0 = time.time()
    rt = threading.Thread(target=reader, daemon=True)
    rt.start()

    # pi buffers stdin until the RPC loop is ready; no boot delay needed.
    time.sleep(0.3)
    send(proc, lock, {"id": "p1", "type": "prompt", "message": args.prompt})

    finished = settled.wait(args.timeout)
    duration = round(time.time() - t0, 1)

    if not finished:
        state["stop_reason"] = "timeout"
    time.sleep(0.5)

    try:
        proc.stdin.close()
    except OSError:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()

    with open(args.out, "w") as f:
        for rec in events:
            f.write(json.dumps(rec) + "\n")

    summary = {
        "prompt": args.prompt,
        "ext": args.ext,
        "early_stop": args.early_stop,
        "stop_reason": state["stop_reason"],
        "duration_s": duration,
        "ask_calls": state["ask_calls"],
        "tool_calls": state["tool_calls"],
        "dialogs": state["dialogs"],
        "asked_in_text": "?" in state["assistant_text"].rstrip()[-800:],
        "assistant_tail": state["assistant_text"][-600:],
        "ask_result_texts": state["ask_result_texts"],
        "exit_code": proc.returncode,
    }
    with open(args.summary, "w") as f:
        json.dump(summary, f, indent=1)
    print(json.dumps({k: summary[k] for k in
                      ("stop_reason", "duration_s", "ask_calls", "tool_calls")}))
    shutil.rmtree(workdir, ignore_errors=True)
    return 0 if finished else 2


if __name__ == "__main__":
    sys.exit(main())
