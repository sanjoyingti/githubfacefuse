# ConvTranspose pads [0,0,1,1] -> pads 0 + Slice dropping the last row/column.
import sys, onnx, numpy as np
from onnx import helper, numpy_helper
m = onnx.load(sys.argv[1]); g = m.graph
nodes = list(g.node); out = []; k = 0
def const(name, arr):
    g.initializer.append(numpy_helper.from_array(np.array(arr, dtype=np.int64), name))
for n in nodes:
    out.append(n)
    if n.op_type != "ConvTranspose": continue
    pads = [list(a.ints) for a in n.attribute if a.name == "pads"]
    if not pads or pads[0] != [0, 0, 1, 1]: continue
    for a in list(n.attribute):
        if a.name == "pads": n.attribute.remove(a)
    n.attribute.append(helper.make_attribute("pads", [0, 0, 0, 0]))
    y = n.output[0]; tmp = y + "_full"; n.output[0] = tmp
    s, e, ax = f"dc_s{k}", f"dc_e{k}", f"dc_a{k}"
    const(s, [0, 0]); const(e, [-1, -1]); const(ax, [2, 3])
    out.append(helper.make_node("Slice", [tmp, s, e, ax], [y], name=f"dc_crop{k}")); k += 1
del g.node[:]; g.node.extend(out)
onnx.checker.check_model(m); onnx.save(m, sys.argv[2]); print("deconv fixed", k)
