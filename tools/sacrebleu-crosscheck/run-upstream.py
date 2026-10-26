#!/usr/bin/env python3
"""用 vendored 的上游 sacrebleu chrF 实现算出对照值，供 compare.cjs 与 JS 移植比对。

上游文件不做任何修改：脚本在 tools/sacrebleu-crosscheck/_pkg/ 下临时搭一个最小包，
把 vendor/sacrebleu/{chrf.py,helpers.py} 复制进去，并补上 chrf.py 需要的最小依赖
（utils.sum_of_lists、metrics.base 的 Metric/Score/Signature 空壳）。

注意：上游 base.Metric 会在评分前对 hyp/ref 调用 _preprocess_segment（lowercase 等），
直接调用内部方法时必须自己补这一步，否则 lowercase=True 的用例会得到错误对照值。

用法： python tools/sacrebleu-crosscheck/run-upstream.py
      （需 stdlib 即可，不需要安装 sacrebleu；上游源码已在 vendor/ 中）
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
VENDOR = os.path.join(ROOT, 'vendor', 'sacrebleu')
# 最小包壳建在本目录下的 _pkg/，脚本结束时会清掉（系统临时目录在部分沙箱下不可写）
PKG = os.path.join(HERE, '_pkg', 'sb')

BASE_STUB = '''"""最小替身：只满足 chrf.py 的 import 与构造需求，不实现语料级评分。"""


class Signature:
    def __init__(self, args):
        self.args = args or {}
        self._abbr = {}
        self.info = {}


class Score:
    def __init__(self, name, score):
        self.name = name
        self.score = score


class Metric:
    def __init__(self):
        pass
'''

UTILS_STUB = '''def sum_of_lists(lists):
    return [sum(values) for values in zip(*lists)]
'''


def build_package():
    root = os.path.dirname(PKG)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(os.path.join(PKG, 'metrics'))
    open(os.path.join(PKG, '__init__.py'), 'w').close()
    open(os.path.join(PKG, 'metrics', '__init__.py'), 'w').close()
    with open(os.path.join(PKG, 'metrics', 'base.py'), 'w', encoding='utf-8') as fh:
        fh.write(BASE_STUB)
    with open(os.path.join(PKG, 'utils.py'), 'w', encoding='utf-8') as fh:
        fh.write(UTILS_STUB)
    for name in ('chrf.py', 'helpers.py'):
        shutil.copyfile(os.path.join(VENDOR, name), os.path.join(PKG, 'metrics', name))


def main():
    if not os.path.isfile(os.path.join(VENDOR, 'chrf.py')):
        sys.exit('缺少 vendor/sacrebleu/chrf.py：请先按 vendor/sacrebleu/README.md 取回上游源码')
    build_package()
    sys.path.insert(0, os.path.dirname(PKG))
    from sb.metrics.chrf import CHRF

    cases = json.load(open(os.path.join(HERE, 'cases.json'), encoding='utf-8'))
    out = {}
    for name, hyp, ref, opts in cases:
        chrf = CHRF(char_order=opts.get('charOrder', 6), word_order=opts.get('wordOrder', 0),
                    beta=opts.get('beta', 2), lowercase=opts.get('lowercase', False),
                    whitespace=opts.get('whitespace', False), eps_smoothing=opts.get('epsSmoothing', False))
        hyp_p = chrf._preprocess_segment(hyp)
        ref_p = chrf._preprocess_segment(ref)
        refs = chrf._extract_reference_info([ref_p])
        stats = chrf._compute_segment_statistics(hyp_p, refs)
        out[name] = chrf._compute_score_from_stats(stats).score
    target = os.path.join(HERE, 'upstream.json')
    json.dump(out, open(target, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('上游对照值已写入 ' + os.path.relpath(target, ROOT) + '（' + str(len(out)) + ' 个用例）')


if __name__ == '__main__':
    try:
        main()
    finally:
        # 包壳只是编译上游源码用的临时结构，跑完即删
        shutil.rmtree(os.path.dirname(PKG), ignore_errors=True)