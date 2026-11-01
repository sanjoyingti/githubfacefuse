# Fold constant-zero Pad nodes (N,C untouched) into the Conv that consumes them.
import sys, onnx
from onnx import numpy_helper, helper
m = onnx.load(sys.argv[1]); g = m.graph
init = {i.name: numpy_helper.to_array(i) for i in g.initializer}
consumers = {}
for n in g.node:
    for x in n.input: consumers.setdefault(x, []).append(n)
folded, remove = 0, []
for n in g.node:
    if n.op_type != "Pad": continue
    pads = init.get(n.input[1]); val = init.get(n.input[2]) if len(n.input) > 2 and n.input[2] else 0
    mode = [a.s for a in n.attribute if a.name == "mode"]
    if pads is None or (mode and mode[0] != b"constant") or (val is not None and float(val) != 0): continue
    pads = pads.tolist()
    if len(pads) != 8 or pads[0] or pads[1] or pads[4] or pads[5]: continue
    cs = consumers.get(n.output[0], [])
    if not cs or any(c.op_type != "Conv" for c in cs): continue
    for c in cs:
        old = [0, 0, 0, 0]
        for a in list(c.attribute):
            if a.name == "pads": old = list(a.ints); c.attribute.remove(a)
            if a.name == "auto_pad": c.attribute.remove(a)
        c.attribute.append(helper.make_attribute("pads", [old[0] + pads[2], old[1] + pads[3], old[2] + pads[6], old[3] + pads[7]]))
        c.input[0] = n.input[0]
    remove.append(n); folded += 1
for n in remove: g.node.remove(n)
onnx.checker.check_model(m); onnx.save(m, sys.argv[2])
print("folded", folded, "remaining Pad", sum(n.op_type == "Pad" for n in g.node))
