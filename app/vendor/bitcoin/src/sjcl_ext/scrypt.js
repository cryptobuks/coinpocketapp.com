// taken from https://github.com/joe-invincible/sjcl-scrypt/blob/master/sjcl-scrypt.js
(function() {

  function flipEndian(x) {
    var first = x & 0xFF;
    var second = (x >>> 8) & 0xFF;
    var third = (x >>> 16) & 0xFF;
    var fourth = (x >>> 24) & 0xFF;
    return (first << 24) | (second << 16) | (third << 8) | fourth;
  }
  
  function sanityCheck(N, r, p) {
    if (r * p >= Math.pow(2, 30)) {
      throw "The parameters r, p must satisfy r * p < 2^30";
    }
    if ((N < 2) || (N & (N - 1) !== 0)) {
      throw "The parameter N must be a power of 2.";
    }
    var SIZE_MAX = Math.pow(2, 32) - 1;
    if (N > SIZE_MAX / 128 / r) {
    throw "N too big.";
    }
    if (r > SIZE_MAX / 128 / p) {
      throw "r too big.";
    }
  }

  function scrypt(passwd, salt, N, r, p, dkLen) {
    var B = sjcl.misc.pbkdf2(passwd, salt, 1, p * 128 * r * 8);
    var V = []; 
    var XY = [];
    for (var i = 0; i < p; i++) {
      smix(B, i * 128 * r, r, N, V, XY);
    }
    return sjcl.misc.pbkdf2(passwd, B, 1, dkLen * 8);
  }

  function salsa20_8(B) {

    function R(a, b) {
      return (a << b) | (a >>> (32 - b));
    }
    
    var B32 = [];
    for (var i = 0; i < 16; i++) {
      B32[i] = flipEndian(B[i]);  
    }
  
    var x = [];
    for (var j = 0; j < 16; j++) {
      x[j] = B32[j] | 0;
    }
  
    for (var k = 8; k > 0; k -= 2) {
      x[4] ^= R(x[0] + x[12], 7);
      x[8] ^= R(x[4] + x[0], 9);
      x[12] ^= R(x[8] + x[4], 13);
      x[0] ^= R(x[12] + x[8], 18);
      x[9] ^= R(x[5] + x[1], 7);
      x[13] ^= R(x[9] + x[5], 9);
      x[1] ^= R(x[13] + x[9], 13);
      x[5] ^= R(x[1] + x[13], 18);
      x[14] ^= R(x[10] + x[6], 7);
      x[2] ^= R(x[14] + x[10], 9);
      x[6] ^= R(x[2] + x[14], 13);
      x[10] ^= R(x[6] + x[2], 18);
      x[3] ^= R(x[15] + x[11], 7);
      x[7] ^= R(x[3] + x[15], 9);
      x[11] ^= R(x[7] + x[3], 13);
      x[15] ^= R(x[11] + x[7], 18);
      x[1] ^= R(x[0] + x[3], 7);
      x[2] ^= R(x[1] + x[0], 9);
      x[3] ^= R(x[2] + x[1], 13);
      x[0] ^= R(x[3] + x[2], 18);
      x[6] ^= R(x[5] + x[4], 7);
      x[7] ^= R(x[6] + x[5], 9);
      x[4] ^= R(x[7] + x[6], 13);
      x[5] ^= R(x[4] + x[7], 18);
      x[11] ^= R(x[10] + x[9], 7);
      x[8] ^= R(x[11] + x[10], 9);
      x[9] ^= R(x[8] + x[11], 13);
      x[10] ^= R(x[9] + x[8], 18);
      x[12] ^= R(x[15] + x[14], 7);
      x[13] ^= R(x[12] + x[15], 9);
      x[14] ^= R(x[13] + x[12], 13);
      x[15] ^= R(x[14] + x[13], 18);
    }
  
    for (var l = 0; l < 16; l++) {
      B32[l] = (B32[l] + x[l]) | 0;
    }
    
    for (var m = 0; m < 16; m++) {
      B[m] = flipEndian(B32[m]);  
    }
  
    return B;
  }

  function blockxor(S, Si, D, Di, len) {
    len /= 4;
    Si /= 4;
    Di /= 4;
    for (var i = 0; i < len; i++) {
      D[Di + i] ^= S[Si + i] | 0;
    }
  }
  
  function blockcopy(S, Si, D, Di, len) {
    len /= 4;
    Si /= 4;
    Di /= 4;
    for (var i = 0; i < len; i++) {
      D[Di + i] = S[Si + i] | 0;
    }
  }
  
  function blockmix_salsa8(BY, Bi, Yi, r) {
    var X = [];
    var i;
  
    blockcopy(BY, Bi + (2 * r - 1) * 64, X, 0, 64);
  
    for (i = 0; i < 2 * r; i++) {
        blockxor(BY, i * 64, X, 0, 64);
        salsa20_8(X);
        blockcopy(X, 0, BY, Yi + (i * 64), 64);
    }
  
    for (i = 0; i < r; i++) {
        blockcopy(BY, Yi + (i * 2) * 64, BY, Bi + (i * 64), 64);
    }
  
    for (i = 0; i < r; i++) {
        blockcopy(BY, Yi + (i * 2 + 1) * 64, BY, Bi + (i + r) * 64, 64);
    }
  }
  
  function smix(B, Bi, r, N, V, XY) {
    var Xi = 0;
    var Yi = 128 * r;
    var i;
  
    blockcopy(B, Bi, XY, Xi, Yi);
  
    for (i = 0; i < N; i++) {
      blockcopy(XY, Xi, V, i * Yi, Yi);
      blockmix_salsa8(XY, Xi, Yi, r);
    }
  
    for (i = 0; i < N; i++) {
      var j = integerify(XY, Xi, r) & (N - 1);
      blockxor(V, j * Yi, XY, Xi, Yi);
      blockmix_salsa8(XY, Xi, Yi, r);
    }
  
    blockcopy(XY, Xi, B, Bi, Yi);
  }
  
  function integerify(B, Bi, r) {
    Bi = Bi + (2 * r - 1) * 64;
    return flipEndian(B[Bi / 4]);
  }

  sjcl.misc.scrypt = function(passwd, salt, N, r, p, dkLen) {
    if (typeof passwd === 'string') {
      passwd = sjcl.codec.utf8String.toBits(passwd);
    }
    if (typeof salt === 'string') {
      salt = sjcl.codec.utf8String.toBits(salt);
    }

    sanityCheck(N, r, p);
    return scrypt(passwd, salt, N, r, p, dkLen);
  };

})(sjcl);
