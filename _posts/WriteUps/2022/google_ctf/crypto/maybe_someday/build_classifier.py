import hashlib
import random
from Crypto.Util.number import *
from ortools.sat.python import cp_model
from tqdm import tqdm

secrets = [hashlib.sha512(long_to_bytes(i)).hexdigest().encode() for i in range(2**16)]

def any_matches(secret, pos_val_pairs):
    """val_pos is list of value:position pairs"""
    return any(secret[pos]==val for pos,val in pos_val_pairs)

classifier_x = [list(int(chr(j),16) for j in i) for i in secrets]
classifier_y = [random.randint(0,1) for _ in classifier_x]

num_consts = 2**16
num_pairs = 4
model = cp_model.CpModel()
solver = cp_model.CpSolver()


sec = [model.NewIntVar(0,16,f'x_{i}') for i in range(num_pairs)]
reqs = [model.NewBoolVar(f'req_{i}') for i in range(num_consts)]

for i in tqdm(range(num_consts)):
    equality = [model.NewBoolVar(f'eq_{i}') for i in range(num_pairs)]
    # inequality = [model.NewBoolVar(f'ineq_{i}') for i in range(128)]
    for j in range(num_pairs):
        # model.AddImplication(sec[j]==classifier_x[i][j], equality[j])
        model.Add(sec[j]==classifier_x[i][j]).OnlyEnforceIf(equality[j])
        model.Add(sec[j]!=classifier_x[i][j]).OnlyEnforceIf(equality[j].Not())
        # model.Add(sec[j]!=classifier_x[i][j]).OnlyEnforceIf(inequality[j])
        # model.Add(equality[j]!=inequality[j])
    if classifier_y[i]:
        model.AddBoolOr(*equality).OnlyEnforceIf(reqs[i])
    else:
        model.AddBoolAnd(*[c.Not() for c in equality]).OnlyEnforceIf(reqs[i])
    # model.Add(sum([a==b for a,b in zip(sec,classifier_x[i])])>0 )
    # if classifier_y:
    #     model.AddBoolOr(*[a==b for a,b in zip(sec,classifier_x[i])]).OnlyEnforceIf(reqs[i])
    # else:
    #     model.AddBoolOr(*[a==b for a,b in zip(sec,classifier_x[i])]).OnlyEnforceIf(reqs[i].Not())
model.Maximize(sum(reqs))
solver.parameters.max_time_in_seconds = 300
solver.Solve(model)
print(solver.WallTime())
print(solver.ObjectiveValue())
secs = [solver.Value(i) for i in sec]
pairs = [(i,v) for i,v in enumerate(secs) if v!=16]
print(len(pairs))
print(pairs)
