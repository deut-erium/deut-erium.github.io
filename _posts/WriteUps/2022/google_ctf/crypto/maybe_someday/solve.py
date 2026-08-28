from chall import *
from Crypto.Util.number import *
from collections import defaultdict, Counter
import hashlib
from Crypto.Util.number import bytes_to_long, long_to_bytes
from sklearn.tree import DecisionTreeClassifier
import random
import simanneal


secrets = [hashlib.sha512(long_to_bytes(i)).hexdigest().encode() for i in range(2**16)]

def any_matches(secret, pos_val_pairs):
    """val_pos is list of value:position pairs"""
    return any(secret[pos]==val for pos,val in pos_val_pairs)

# best_seed, best_val = 0,0
# best_pairs = None
classifier_x = [list(int(chr(j),16) for j in i) for i in secrets]
# classifier_y = [0 if i[0]<8 else 1 for i in classifier_x]
# for seed in range(0,200000,20):
#     pairs = []
#     for i in range(20):
#         # decision_tree = DecisionTreeClassifier(max_features=1,max_leaf_nodes=12,splitter="random",random_state=seed+i)
#         # # i = i%16
#         # # classifier_y = [0]*2**(15-i) + [1]*2**(15-i)
#         # # classifier_y*=2**i
#         # random.shuffle(classifier_y)
#         # # decision_tree = DecisionTreeClassifier(max_features=1,max_depthmax_leaf_nodes=12,splitter="random")
#         # decision_tree.fit(classifier_x, classifier_y)
#         # pos_vals = {(i, ord(hex(int(j))[2:])) for i,j in zip(decision_tree.tree_.feature, decision_tree.tree_.threshold) if i>=0}
#         # print(sum(any_matches(i,pos_vals) for i in secrets))
#         pos_vals = [(random.randint(0,127),random.randint(0,15)) for _ in range(11)]
#         pos_vals = [(i, ord(hex(int(j))[2:])) for i,j in pos_vals]
#         pairs.append(pos_vals)

#     val = len({tuple(any_matches(i, pv) for pv in pairs) for i in secrets})
#     if val>best_val:
#         best_val = val
#         best_seed = seed
#         best_pairs = pairs
#     print(seed,val,best_val)


# init_state = []
# classifier_y = [0]*2**15 + [1]*2**15
# position_hists = [Counter([i[j] for i in classifier_x]) for j in range(128)]

def classifier():
    class Classifier(simanneal.Annealer):
        def __init__(self, state):
            super(Classifier, self).__init__(state)

        def move(self):
            initial_energy = self.energy()
            self.state[random.randint(0,len(self.state)-1)][1] = random.randint(0,15)
            return self.energy() - initial_energy

        def energy(self):
            matches =  sum(any_matches(i,self.state) for i in classifier_x)
            return abs(2**15-matches)
    init_state = []
    for _ in range(11):
        pos = random.randint(0,127)
        init_state.append([pos, random.randint(0,15)])
    clf = Classifier(init_state)
    clf.copy_stratergy = "copy"
    clf.steps= 500
    clf.updates = 200
    clf.Tmax = 5000
    pairs, e = clf.anneal()
    print()
    print(e)
    return pairs

pairs = [classifier() for _ in range(20)]
pairs = [[(i,ord(hex(v)[2:])) for i,v in pp] for pp in pairs]
print(len({tuple(any_matches(i, pv) for pv in pairs) for i in secrets}))

def generate_query(pos_vals):
    query = bytearray(128)
    for pos,val in pos_vals:
        query[pos] = val
    return 2**1024 - bytes_to_long(query[::-1])

def homomorphic_add(c0, c1, n, g):
    return c0 * pow(g, c1, n**2) % n**2

# mapping = defaultdict(list)
# for s in secrets:
#     mapping[tuple(any_matches(s, pv) for pv in pairs)].append(s)

# p = Paillier()

# secret = hashlib.sha512(os.urandom(2)).hexdigest().encode()
# c0 = p.encrypt(secret)
# n,g = p.n, p.g
# def try_decryption(p, c):
#     try:
#         p.fast_decrypt(c)
#         return True
#     except:
#         return False

# # responses = tuple(try_decryption(p, homomorphic_add(c0, generate_query(pair), n, g)) for pair in pairs)

# # secrets_int = list(map(bytes_to_long,secrets))



# 63582
# best_pairs = [[(44, 49), (123, 54), (103, 100), (7, 50), (96, 54), (9, 49), (118, 50), (51, 52), (122, 49), (88, 102), (89, 99)], [(74, 54), (27, 48), (19, 101), (101, 56), (12, 54), (83, 50), (19, 101), (62, 51), (101, 98), (45, 55), (57, 55)], [(26, 54), (18, 51), (111, 48), (88, 100), (10, 57), (2, 99), (85, 99), (70, 48), (36, 52), (50, 97), (78, 55)], [(106, 48), (38, 55), (109, 50), (91, 98), (119, 49), (43, 55), (106, 102), (42, 51), (39, 56), (73, 100), (86, 51)], [(9, 51), (84, 50), (55, 102), (12, 51), (49, 48), (106, 55), (109, 51), (33, 99), (113, 50), (39, 56), (59, 102)], [(24, 52), (30, 52), (14, 99), (19, 48), (52, 51), (18, 50), (69, 57), (75, 51), (121, 52), (116, 54), (114, 99)], [(109, 97), (94, 53), (92, 101), (33, 101), (66, 54), (55, 57), (5, 102), (104, 49), (109, 101), (24, 54), (56, 56)], [(2, 56), (44, 55), (126, 48), (51, 50), (73, 54), (102, 50), (99, 48), (57, 54), (49, 50), (56, 52), (70, 54)], [(47, 99), (52, 56), (29, 54), (85, 51), (60, 57), (94, 56), (50, 54), (79, 97), (121, 52), (43, 49), (49, 97)], [(2, 52), (93, 48), (105, 49), (96, 54), (90, 48), (118, 102), (113, 51), (37, 100), (102, 101), (70, 102), (116, 57)], [(124, 101), (122, 50), (80, 99), (19, 51), (121, 51), (19, 49), (124, 54), (104, 98), (115, 54), (34, 49), (77, 51)], [(121, 101), (2, 56), (50, 56), (22, 56), (78, 98), (58, 57), (85, 102), (17, 100), (82, 48), (104, 55), (113, 57)], [(49, 52), (2, 98), (22, 100), (29, 57), (47, 57), (107, 55), (109, 51), (95, 52), (2, 48), (26, 49), (103, 55)], [(39, 53), (92, 52), (8, 50), (124, 101), (14, 52), (50, 97), (73, 49), (102, 100), (32, 51), (10, 48), (28, 52)], [(26, 52), (90, 51), (87, 50), (116, 52), (40, 51), (125, 101), (89, 56), (99, 57), (100, 50), (46, 57), (33, 57)], [(121, 53), (46, 100), (67, 97), (33, 99), (120, 56), (113, 51), (15, 97), (76, 100), (44, 98), (20, 99), (46, 100)], [(43, 55), (18, 48), (10, 48), (101, 52), (98, 98), (106, 56), (103, 48), (15, 55), (69, 52), (37, 97), (59, 101)], [(86, 52), (34, 57), (67, 55), (99, 97), (46, 49), (122, 101), (62, 56), (117, 101), (85, 100), (89, 101), (46, 55)], [(89, 56), (88, 54), (30, 55), (88, 56), (88, 97), (74, 51), (107, 52), (112, 51), (78, 48), (74, 49), (52, 53)], [(89, 55), (33, 54), (5, 56), (104, 100), (76, 98), (17, 51), (44, 101), (23, 50), (20, 50), (79, 99), (43, 97)]]
