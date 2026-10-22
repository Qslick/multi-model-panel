"""Offline contract checks; real provider smoke tests remain separate."""
import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import panel

REPLY = '''VERDICT: APPROVE
CONFIDENCE: high
TOP_RISKS:
- none
DISAGREEMENTS:
- none
GAPS:
- none
WOULD_CHANGE_MY_MIND:
- Counterexample.
MODEL_SELF_REPORT: test
'''

class PanelTests(unittest.TestCase):
    def test_both_directions_and_unknown(self):
        self.assertEqual(panel.resolve('gpt-6-sol')[1]['codex']['model'], 'gpt-6-astra')
        self.assertEqual(panel.resolve('gpt-6-astra')[1]['codex']['model'], 'gpt-6-sol')
        with self.assertRaises(ValueError):
            panel.resolve('gpt-6')

    def test_exact_session_latest_turn_not_unrelated_task(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'sessions').mkdir()
            path = root/'sessions/rollout-abc.jsonl'
            path.write_text('\n'.join(json.dumps({'type':'turn_context', 'payload':{'model': model}})
                                      for model in ('gpt-6-sol','gpt-6-astra')) + '\n{')
            (root/'sessions/rollout-other.jsonl').write_text(json.dumps(
                {'type':'turn_context','payload':{'model':'gpt-6-sol'}}))
            self.assertEqual(panel.current_model(root, 'abc'), 'gpt-6-astra')
            with self.assertRaises(ValueError):
                panel.current_model(root, None)
            with self.assertRaises(ValueError):
                panel.current_model(root, 'missing')

    def test_dispatch_preserves_packet_and_controls(self):
        _, roster = panel.resolve('gpt-6-sol')
        packet = 'literal `echo bad` $(echo bad)\nsecond line'
        args = (Path('/tmp/project with spaces'), Path('/tmp/packet.md'), packet, Path('/tmp/reply.md'))
        for seat in panel.SEATS:
            cmd, stdin = panel.command(seat, roster[seat], *args)
            self.assertIn(roster[seat]['model'], cmd)
            if seat in ('claude','codex'):
                self.assertEqual(stdin, packet)
            if seat == 'codex':
                self.assertIn('read-only', cmd)
                self.assertIn('--ignore-user-config', cmd)
            elif seat == 'claude':
                self.assertIn('--safe-mode', cmd)
                self.assertIn('Read,Grep,Glob', cmd)
                self.assertIn('--strict-mcp-config', cmd)
            elif seat == 'grok':
                self.assertIn('MCPTool', cmd)
                self.assertIn('search_tool,use_tool,Agent', cmd)
                self.assertIn('read_file,grep,list_dir', cmd)
            else:
                self.assertEqual(cmd[2], packet)
                self.assertIn('--disable-slash-commands', cmd)

    def test_provider_extraction_and_error_not_verdict(self):
        raw = '\n'.join(json.dumps(x) for x in (
            {'type':'assistant','text':'narration'}, {'type':'result','result':REPLY}))
        text, errors, _ = panel.extract('grok', raw, Path('/unused'))
        self.assertEqual(text, REPLY)
        self.assertFalse(errors)
        raw = json.dumps({'type':'result','is_error':True,'result':'usage limit'})
        text, errors, _ = panel.extract('claude', raw, Path('/unused'))
        self.assertEqual(text, '')
        self.assertTrue(errors)
        self.assertTrue(panel.valid_reply(REPLY))
        self.assertFalse(panel.valid_reply('VERDICT: APPROVE'))
        self.assertFalse(panel.valid_reply(REPLY.replace('APPROVE', 'MAYBE')))

    def test_actual_child_failure_timeout_and_artifact_preservation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packet = root/'packet.md'
            packet.write_text('test')
            args = argparse.Namespace(project=root, packet=packet, output_dir=root/'output',
                                      seat='gemini', timeout=1)
            _, roster = panel.resolve('gpt-6-astra')
            with patch.object(panel, 'command', return_value=(['/bin/sleep','10'], None)):
                self.assertEqual(panel.run_seat(args, 'gpt-6-astra', roster), 1)
            receipt = json.loads((root/'output/gemini.json').read_text())
            self.assertEqual(receipt['error'], 'timeout')
            with self.assertRaises(FileExistsError):
                panel.run_seat(args, 'gpt-6-astra', roster)

if __name__ == '__main__':
    unittest.main()
