#!/usr/bin/env python3
"""Resolve the opposite Codex model and run one bounded, read-only panel seat."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
SEATS = ('codex', 'gemini', 'grok', 'claude')
LABELS = ('CONFIDENCE', 'TOP_RISKS', 'DISAGREEMENTS', 'GAPS',
          'WOULD_CHANGE_MY_MIND', 'MODEL_SELF_REPORT')


def now():
    return datetime.now(timezone.utc).isoformat()


def current_model(codex_home, thread_id):
    if not thread_id or not re.fullmatch(r'[a-zA-Z0-9_-]+', thread_id):
        raise ValueError('No valid current CODEX_THREAD_ID; supply a verified --convener-model')
    matches = list((codex_home / 'sessions').rglob(f'*-{thread_id}.jsonl'))
    if len(matches) != 1:
        raise ValueError('Cannot uniquely locate current task metadata; supply a verified --convener-model')
    model = None
    with matches[0].open() as stream:
        for line in stream:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue  # A live transcript may have an unfinished final line.
            if event.get('type') == 'turn_context':
                model = event.get('payload', {}).get('model')
    if not model:
        raise ValueError('Current task has no model metadata; supply a verified --convener-model')
    return model


def resolve(model=None):
    roster = json.loads((ROOT / 'roster.json').read_text())
    if model is None:
        codex_home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
        model = current_model(codex_home, os.environ.get('CODEX_THREAD_ID'))
    opposite = roster['codex'].pop('opposite_model')
    if model not in opposite:
        raise ValueError(f'Unsupported convener model {model!r}; supported: {", ".join(opposite)}')
    roster['codex']['model'] = opposite[model]
    return model, {seat: roster[seat] for seat in SEATS}


def executable(name):
    preferred = {'agy': Path.home() / '.local/bin/agy',
                 'grok': Path.home() / '.grok/bin/grok',
                 'claude': Path.home() / '.local/bin/claude'}
    path = preferred.get(name)
    if path and path.is_file() and os.access(path, os.X_OK):
        return str(path)
    return shutil.which(name) or name


def command(seat, spec, project, packet_path, packet, reply):
    model = spec['model']
    if seat == 'codex':
        return [executable('codex'), 'exec', '--ignore-user-config',
                '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral',
                '--model', model, '-c', f'model_reasoning_effort="{spec["effort"]}"',
                '-c', 'approval_policy="never"', '-C', str(project),
                '-o', str(reply), '-'], packet
    if seat == 'gemini':
        return [executable('agy'), '-p', packet, '--model', model,
                '--disable-slash-commands', '--print-timeout', '8m',
                '--add-dir', str(project)], None
    if seat == 'grok':
        return [executable('grok'), '--prompt-file', str(packet_path), '--verbatim',
                '-m', model, '--reasoning-effort', spec['effort'], '--cwd', str(project),
                '--output-format', 'streaming-messages-json',
                '--tools', 'read_file,grep,list_dir',
                '--disallowed-tools', 'search_tool,use_tool,Agent', '--deny', 'MCPTool',
                '--disable-web-search', '--no-subagents'], None
    return [executable('claude'), '--print', '--model', model, '--effort', spec['effort'],
            '--safe-mode', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob',
            '--permission-mode', 'dontAsk', '--strict-mcp-config',
            '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
            '--no-session-persistence', '--output-format', 'json'], packet


def extract(seat, raw, reply):
    errors = []
    metadata = {}
    if seat == 'codex':
        return (reply.read_text() if reply.exists() else ''), errors, metadata
    if seat == 'gemini':
        return raw, errors, metadata
    records = []
    for line in raw.splitlines():
        try:
            record = json.loads(line)
            if isinstance(record, dict):
                records.append(record)
        except json.JSONDecodeError:
            continue
    result = ''
    for record in records:
        if record.get('is_error') or record.get('type') == 'error':
            errors.append(record)
        elif record.get('type') == 'result' and isinstance(record.get('result'), str):
            result = record['result']
        if record.get('model'):
            metadata['model'] = record['model']
        if record.get('modelUsage'):
            metadata['modelUsage'] = record['modelUsage']
    return result, errors, metadata


def valid_reply(text):
    # Normalize only leading formatting, preserving the source artifact.
    lines = [re.sub(r'^[\s*#`]+', '', line).rstrip('*` ') for line in text.splitlines()]
    if not any(re.fullmatch(r'VERDICT:\s*(APPROVE|APPROVE_WITH_CHANGES|REJECT|NEED_INFO)', line)
               for line in lines):
        return False
    return all(any(line.startswith(label + ':') for line in lines) for label in LABELS)


def run_seat(args, convener, roster):
    project = args.project.expanduser().resolve(strict=True)
    packet_path = args.packet.expanduser().resolve(strict=True)
    packet = packet_path.read_text()
    if not project.is_dir() or not packet.strip():
        raise ValueError('Project must be a directory and packet must be nonempty')
    out = args.output_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    seat = args.seat
    receipt_path = out / f'{seat}.json'
    # Exclusive creation prevents accidental overwrites or duplicate live dispatches.
    with receipt_path.open('x') as stream:
        json.dump({'status': 'STARTING', 'started_at': now()}, stream)
    reply = out / f'{seat}.md'
    cmd, stdin = command(seat, roster[seat], project, packet_path, packet, reply)
    receipt = {'seat': seat, 'family': roster[seat]['family'], 'convener_model': convener,
               'model_requested': roster[seat]['model'], 'effort': roster[seat].get('effort'),
               'packet_sha256': hashlib.sha256(packet.encode()).hexdigest(),
               'packet': str(packet_path), 'project': str(project),
               'command': ['<packet text>' if arg == packet else arg for arg in cmd],
               'started_at': now()}
    env = os.environ.copy()
    if seat == 'grok':
        env['GROK_MEMORY'] = '0'
    error = None
    exit_code = None
    with (out / f'{seat}.stdout').open('w') as stdout, (out / f'{seat}.stderr').open('w') as stderr:
        try:
            proc = subprocess.Popen(cmd, cwd=project, env=env, text=True,
                                    stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                                    stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                proc.communicate(input=stdin, timeout=args.timeout)
                exit_code = proc.returncode
            except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                error = 'timeout' if isinstance(exc, subprocess.TimeoutExpired) else 'interrupted'
                exit_code = proc.returncode
        except OSError as exc:
            error = str(exc)
            stderr.write(error + '\n')
    raw = (out / f'{seat}.stdout').read_text()
    text, provider_errors, provider_metadata = extract(seat, raw, reply)
    reply.write_text(text)
    success = exit_code == 0 and not error and not provider_errors and valid_reply(text)
    receipt.update(ended_at=now(), exit_code=exit_code, error=error,
                   provider_errors=provider_errors, provider_metadata=provider_metadata,
                   status='SUCCESS' if success else 'UNAVAILABLE')
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'seat': seat, 'status': receipt['status'],
                      'model_requested': roster[seat]['model'], 'receipt': str(receipt_path)}))
    return 0 if success else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    resolution = sub.add_parser('resolve')
    resolution.add_argument('--convener-model')
    seat = sub.add_parser('seat')
    seat.add_argument('seat', choices=SEATS)
    seat.add_argument('--convener-model')
    seat.add_argument('--project', type=Path, required=True)
    seat.add_argument('--packet', type=Path, required=True)
    seat.add_argument('--output-dir', type=Path, required=True)
    seat.add_argument('--timeout', type=int, default=570)
    args = parser.parse_args()
    try:
        convener, roster = resolve(args.convener_model)
        if args.action == 'resolve':
            print(json.dumps({'convener_model': convener, 'seats': roster}, indent=2))
            return 0
        if not 1 <= args.timeout <= 570:
            raise ValueError('Timeout must be between 1 and 570 seconds')
        return run_seat(args, convener, roster)
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
