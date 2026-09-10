# AST-extracted functions/classes from Cyber Apocalypse 2023 Blokechain.
# Original SHA-256: c4974c9b2a81981b399f1e1217af58dfbe4461c89f02d92c00fe51d15edce363
# The inspected source has no license header. No imports or service entrypoint.
# generate-reference.py supplies controlled globals; do not run as a service.

def random_formula(num_vars, num_clauses):
    formula = []
    for _ in range(num_clauses):
        clause = set()
        for _ in range(random.randint(1,num_vars)):
            clause.add(random.randint(1,num_vars))
        formula.append(tuple(random.choice([-1,1])*j for j in clause))
    return tuple(formula)

def eval_formula(clause,vars):
    return reduce(or_, (reduce(and_,(vars[c-1] if c>0 else not(vars[-c-1]) for c in cl)) for cl in clause))

def get_balanced(num_vars, num_clauses, num_trials=512, thresh=0.05):
    while True:
        balance = 0
        dnf = random_formula(num_vars,num_clauses)
        for _ in range(num_trials):
            x = [random.randint(0,1) for _ in range(num_vars)]
            if eval_formula(dnf, x):
                balance += 1
            else:
                balance -= 1
        if -num_trials*thresh < balance < num_trials*thresh:
            return dnf

class PrivateHash:
    def __init__(self, N_in, N_out, n_clauses=9, verif_lvl=512):
        self.N_in = N_in
        self.N_out = N_out
        self.functions = [get_balanced(N_in, n_clauses, verif_lvl) for _ in tqdm(range(N_out))]

    def hash(self, numb):
        assert numb.bit_length()<=self.N_in
        numb_bits = list(map(int,bin(numb)[2:].zfill(self.N_in)))
        res = 0
        for i in range(self.N_out):
            res *= 2
            res += eval_formula(self.functions[i], numb_bits)
        return res

class BlokeChain:
    def __init__(self,N,O,n_cl=9,verif_lvl=512):
        self.mining_rate = 1 # 1 bloke per second
        self.num_new = self.mining_rate*60 # number of new blokes per second
        self.N = N
        self.O = O
        self.H = PrivateHash(N, O, n_cl, verif_lvl)
        self.B = 0

    def get_pending_blocks(self):
        self.start_time = time()
        self.blokes = [(randbelow(2**self.N), randbelow(100_000)) for _ in range(self.num_new)]

    def verify_chain(self, hashes):
        num_unmined = int(time()-self.start_time)//self.mining_rate
        total_payout = 0
        for i in range(num_unmined, len(self.blokes)):
            bloke_hash = self.H.hash(self.blokes[i][0])
            if bloke_hash == hashes[i]:
                total_payout += self.blokes[i][1]
            print(f"expected hash {hex(bloke_hash)[2:].zfill(self.O//4)} for {self.blokes[i][0]} got {hex(hashes[i])[2:].zfill(self.O//4)}")
        return total_payout
