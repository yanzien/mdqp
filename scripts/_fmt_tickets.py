import json
from datetime import datetime, timedelta

raw = open('C:/Users/xinyu6290/WorkBuddy/2026-08-13-20-39-22/mdqp/scripts/tickets.json', encoding='utf-8').read()
a = raw.find('[')
b = raw.rfind(']')
arr = json.loads(raw[a:b+1])
rows = arr[0]['results']

catmap = {'bug':'🐛程序缺陷','suggestion':'💡功能建议','report':'🚩内容举报','appeal':'⚖️封禁申诉','other':'📌其他'}
stmap = {'open':'待处理','reviewing':'处理中','resolved':'已解决','rejected':'已驳回'}

def bj(s):
    try:
        d = datetime.strptime(s, '%Y-%m-%d %H:%M:%S') + timedelta(hours=8)
        return d.strftime('%Y-%m-%d %H:%M')
    except Exception:
        return s

def line(n, r, idx=False):
    return (f"| {n} " if idx else "| ") + \
        f"| #{r['id']} | {r['code']} | {catmap.get(r['category'], r['category'])} " \
        f"| {stmap.get(r['status'], r['status'])} | {r['author_name']} " \
        f"| {bj(r['created_at'])} | {r['title']} |"

out = []
out.append("# mdqp 工单清单（2026-09-28 整理）\n")
out.append("> 排序规则：**按发布时间（created_at）降序，越晚发布越靠前**（即最新工单在最上面）。\n")
out.append(f"> 共 **{len(rows)}** 条工单。其中 bug（程序缺陷）**{sum(1 for r in rows if r['category']=='bug')}** 条、report（举报）{sum(1 for r in rows if r['category']=='report')} 条、suggestion {sum(1 for r in rows if r['category']=='suggestion')} 条、other {sum(1 for r in rows if r['category']=='other')} 条、appeal {sum(1 for r in rows if r['category']=='appeal')} 条。\n")

# 状态统计
from collections import Counter
bug_status = Counter(r['status'] for r in rows if r['category']=='bug')
out.append(f"> bug 工单状态分布：待处理(open) {bug_status.get('open',0)}、处理中(reviewing) {bug_status.get('reviewing',0)}、已解决(resolved) {bug_status.get('resolved',0)}、已驳回(rejected) {bug_status.get('rejected',0)}。\n")

out.append("## 一、全部工单（最新在最前）\n")
out.append("| # | id | code | 类别 | 状态 | 作者 | 发布(北京时) | 标题 |")
out.append("|---|---|---|---|---|---|---|---|")
for n, r in enumerate(rows, 1):
    out.append(line(n, r))

out.append("\n## 二、仅 BUG 工单（程序缺陷，共 %d 条，重点处理对象）\n" % sum(1 for r in rows if r['category']=='bug'))
out.append("| # | id | code | 状态 | 作者 | 发布(北京时) | 标题 |")
out.append("|---|---|---|---|---|---|---|")
bugs = [r for r in rows if r['category']=='bug']
for n, r in enumerate(bugs, 1):
    out.append(line(n, r))

open('TICKETS-2026-09-28.md', 'w', encoding='utf-8').write('\n'.join(out) + '\n')

# 同时打印到 stdout（精简）
print("总工单:", len(rows))
print("BUG:", sum(1 for r in rows if r['category']=='bug'), "bug状态:", dict(bug_status))
print("\n=== BUG 工单（最新最前）===")
for n, r in enumerate(bugs, 1):
    print(f"{n:>2} #{r['id']:>3} {r['code']:<10} {stmap.get(r['status'],r['status']):<6} {str(r['author_name']):<12} {bj(r['created_at']):<16} {str(r['title'])[:48]}")
print("\n已生成 TICKETS-2026-09-28.md")
