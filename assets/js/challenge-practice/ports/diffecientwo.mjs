// SPDX-License-Identifier: AGPL-3.0-only
// Browser port of SekaiCTF 2023 diffecientwo.
// Derived from assets/challenges/sekaictf-2023-diffecientwo/diffecientwo.py.
// Length limits, all 22 posts, and the Bloom-filter success predicate are unchanged.
import { fromHex, integer } from '../lib/bytes.mjs';
import { BloomFilter, murmur3 } from './bloom-helpers.mjs';

export const PROMOTION_TEXT = '#SEKAICTF #DEUTERIUM #DIFFECIENTWO #CRYPTO';
export const promotionPost = () => new TextEncoder().encode(PROMOTION_TEXT);

export const BANNER = String.raw`
 ____  ____  ____  ____  ____  ___  ____  ____  _  _  ____  _    _  _____
(  _ \(_  _)( ___)( ___)( ___)/ __)(_  _)( ___)( \( )(_  _)( \/\/ )(  _  )
 )(_) )_)(_  )__)  )__)  )__)( (__  _)(_  )__)  )  (   )(   )    (  )(_)(
(____/(____)(__)  (__)  (____)\___)(____)(____)(_)\_) (__) (__/\__)(_____)
Welcome to diffecientwo caching database API for tracking and storing
content across social media. We have repurposed our security product as
saving the admin key was probably not the best idea, but we have decided
to change our policies and to achieve better marketing, we are offering
free API KEY to customers sharing #SEKAICTF #DEUTERIUM #DIFFECIENTWO #CRYPTO
on LonelyFans (our premium business partner).
`;

export class SocialCache extends BloomFilter {
  constructor(modulus, hashes, postSize = 32, numPosts = 16, write = () => {}, hashFunc = murmur3) {
    super(modulus, hashes, hashFunc);
    this.post_size = postSize;
    this._num_posts = numPosts;
    this.write = write;
  }

  add_post(post) {
    if (post.length > this.post_size) this.write('Post too long');
    else if (this._num_posts <= 0) this.write('User exceeded number of allowed posts');
    else {
      this._add(post);
      this._num_posts -= 1;
      this.write(`Added successfully! Posts remaining ${this._num_posts}`);
    }
  }

  find_post(post) {
    this.write(this.check(post) ? 'Found the post in our DB' : 'Could not find post in our DB');
  }

  grant_free_api(win) {
    if (this.check(promotionPost())) win();
    else this.write('Sorry, you dont seem to have posted about us');
  }
}

export async function run(io, options = {}) {
  io.write(BANNER);
  const cache = new SocialCache(2 ** 32 - 5, 64, 32, 22, text => io.write(text));
  while (true) {
    try {
      const option = integer(await io.read('Enter API option:\n'));
      if (option === 1n) {
        cache.find_post(fromHex(await io.read('Enter post in hex\n')));
      } else if (option === 2n) {
        cache.add_post(fromHex(await io.read('Enter post in hex\n')));
      } else if (option === 3n) {
        cache.grant_free_api(() => io.win());
      } else if (option === 4n) {
        // Original except BaseException also catches this SystemExit.
        io.write('Something wrong happened');
        return;
      }
    } catch {
      io.write('Something wrong happened');
      return;
    }
  }
}
