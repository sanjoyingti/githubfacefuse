# Replace pnnx's runtime reshape expressions (6="1,1,//(32,0n),0n") in an ncnn .param with
# the fixed sizes they evaluate to, so ncnn releases older than late 2026 can load it.
#
#   python freeze_reshape.py model.ncnn.param shapes.txt
#
# shapes.txt: "<layer> <dims> <w> <h> <d> <c>" per Reshape, from print_reshape_shapes.cpp
# run on the model with a newer ncnn (the input size is fixed, so the shapes are too).
import re
import sys

param, shapes = sys.argv[1], sys.argv[2]
shape = {}
for line in open(shapes):
    name, dims, w, h, d, c = line.split()
    shape[name] = (int(dims), int(w), int(h), int(d), int(c))
out, frozen = [], 0
for line in open(param):
    f = line.split()
    if len(f) > 1 and f[0] == "Reshape" and '6="' in line:
        dims, w, h, d, c = shape[f[1]]
        head = line[: line.index(" 12=") if " 12=" in line else line.index(' 6="')]
        fixed = {1: f"0={w}", 2: f"0={w} 1={h}", 3: f"0={w} 1={h} 2={c}",
                 4: f"0={w} 1={h} 11={d} 2={c}"}[dims]
        line = head.rstrip() + " " + fixed + "\n"
        frozen += 1
    out.append(line)
open(param, "w").writelines(out)
left = sum('="' in l for l in out)
print(f"frozen {frozen} reshapes, expressions left: {left}")
if left:
    sys.exit(1)
