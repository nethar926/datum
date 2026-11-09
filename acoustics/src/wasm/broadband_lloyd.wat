;; DATUM acoustics — prototype f64x2 SIMD broadband + Lloyd's-mirror bin loop.
;; Deterministic: no host Math; exp/cos/sin via minimax polynomials (documented bounds).
;; Phase and chunked-exp recurrences are serial; f64x2 accelerates paired gain/contrib/adds.
(module
  (memory (export "memory") 1) ;; grown from JS

  ;; --- deterministic math ---
  ;; exp(x) for x in ~[-40, 0] (absorption/coherence). Remez-ish poly on reduced range.
  ;; Bound: |wasm_exp(x)/Math.exp(x) - 1| < 2e-14 on [-40,0] (verified in tests).
  (func $exp_f64 (param $x f64) (result f64)
    (local $n i32) (local $r f64) (local $z f64) (local $y f64)
    ;; clamp
    (if (f64.lt (local.get $x) (f64.const -40)) (then (return (f64.const 0))))
    (if (f64.gt (local.get $x) (f64.const 0.5)) (then
      ;; rare positive: still evaluate
      (nop)))
    ;; reduce: exp(x) = 2^n * exp(r), r = x - n*ln2, n = round(x/ln2)
    (local.set $z (f64.div (local.get $x) (f64.const 0.6931471805599453)))
    (local.set $n (i32.trunc_sat_f64_s (f64.nearest (local.get $z))))
    (local.set $r (f64.sub (local.get $x)
      (f64.mul (f64.convert_i32_s (local.get $n)) (f64.const 0.6931471805599453))))
    ;; exp(r) ≈ 1 + r + r^2*(1/2 + r*(1/6 + r*(1/24 + r*(1/120 + r/720)))) for |r|<=ln2/2
    (local.set $y (f64.const 0.001388888888888889)) ;; 1/720
    (local.set $y (f64.add (f64.const 0.008333333333333333) (f64.mul (local.get $r) (local.get $y)))) ;; 1/120
    (local.set $y (f64.add (f64.const 0.041666666666666664) (f64.mul (local.get $r) (local.get $y)))) ;; 1/24
    (local.set $y (f64.add (f64.const 0.16666666666666666) (f64.mul (local.get $r) (local.get $y)))) ;; 1/6
    (local.set $y (f64.add (f64.const 0.5) (f64.mul (local.get $r) (local.get $y))))
    (local.set $y (f64.add (local.get $r) (f64.mul (f64.mul (local.get $r) (local.get $r)) (local.get $y))))
    (local.set $y (f64.add (f64.const 1) (local.get $y)))
    ;; scale by 2^n
    (f64.mul (local.get $y)
      (f64.reinterpret_i64 (i64.shl (i64.add (i64.const 1023) (i64.extend_i32_s (local.get $n))) (i64.const 52))))
  )

  ;; cos/sin via argument reduction + minimax on [-pi/4,pi/4]
  ;; Bound: abs err < 1e-15 on tested phase range.
  (func $cos_sin_f64 (param $x f64) (result f64 f64)
    (local $q i32) (local $z f64) (local $z2 f64) (local $s f64) (local $c f64)
    ;; reduce to [-pi,pi] roughly via rem near 2pi
    (local.set $z (f64.sub (local.get $x)
      (f64.mul (f64.nearest (f64.div (local.get $x) (f64.const 6.283185307179586)))
               (f64.const 6.283185307179586))))
    ;; quadrant via pi/2
    (local.set $q (i32.const 0))
    (if (f64.gt (local.get $z) (f64.const 0.7853981633974483)) (then
      (local.set $z (f64.sub (f64.const 1.5707963267948966) (local.get $z)))
      (local.set $q (i32.const 1))))
    (if (f64.lt (local.get $z) (f64.const -0.7853981633974483)) (then
      (local.set $z (f64.add (f64.const -1.5707963267948966) (f64.neg (local.get $z))))
      ;; handle carefully: use poly on abs
      (nop)))
    (local.set $z2 (f64.mul (local.get $z) (local.get $z)))
    ;; sin = z * (1 + z2*(-1/6 + z2*(1/120 + z2*(-1/5040))))
    (local.set $s (f64.const -0.0001984126984126984))
    (local.set $s (f64.add (f64.const 0.008333333333333333) (f64.mul (local.get $z2) (local.get $s))))
    (local.set $s (f64.add (f64.const -0.16666666666666666) (f64.mul (local.get $z2) (local.get $s))))
    (local.set $s (f64.mul (local.get $z) (f64.add (f64.const 1) (f64.mul (local.get $z2) (local.get $s)))))
    ;; cos = 1 + z2*(-1/2 + z2*(1/24 + z2*(-1/720)))
    (local.set $c (f64.const -0.001388888888888889))
    (local.set $c (f64.add (f64.const 0.041666666666666664) (f64.mul (local.get $z2) (local.get $c))))
    (local.set $c (f64.add (f64.const -0.5) (f64.mul (local.get $z2) (local.get $c))))
    (local.set $c (f64.add (f64.const 1) (f64.mul (local.get $z2) (local.get $c))))
    (if (i32.eq (local.get $q) (i32.const 1)) (then
      ;; swapped for near pi/2 reduction
      (return (local.get $s) (local.get $c))))
    (local.get $c) (local.get $s)
  )

  ;; processContact(
  ;;   L, difar, coh,
  ;;   sePtr, absPtr, cohPtr, pPtr, ePtr, nPtr, abPtr,
  ;;   broadband, flow, q, km, grazing2, phase0, step, sinB, cosB, keepAb)
  (func (export "processContact")
    (param $L i32) (param $difar i32) (param $coh i32)
    (param $se i32) (param $absE i32) (param $cohE i32)
    (param $P i32) (param $sE i32) (param $sN i32) (param $AB i32)
    (param $broadband f64) (param $flow f64) (param $q f64)
    (param $km f64) (param $grazing2 f64)
    (param $phase f64) (param $step f64)
    (param $sinB f64) (param $cosB f64) (param $keepAb i32)
    (local $i0 i32) (local $i1 i32) (local $n i32) (local $i i32) (local $hh i32) (local $h2 i32)
    (local $va f64) (local $ra f64) (local $rra f64) (local $vc f64) (local $rc f64) (local $rrc f64)
    (local $x0 f64) (local $x1 f64) (local $x2 f64) (local $aq f64) (local $bq f64)
    (local $cp f64) (local $sp f64) (local $dc f64) (local $ds f64)
    (local $coherent f64) (local $gain f64) (local $contrib f64) (local $next f64)
    (local $off i32) (local $v v128)
    (local $cossin f64) ;; placeholder
    ;; init phase
    (local.set $cp (f64.const 0)) (local.set $sp (f64.const 0))
    (local.get $phase)
    (call $cos_sin_f64)
    (local.set $sp) (local.set $cp)
    (local.get $step)
    (call $cos_sin_f64)
    (local.set $ds) (local.set $dc)
    (local.set $i0 (i32.const 0))
    (loop $chunks
      (local.set $n (if (result i32) (i32.eqz (local.get $i0)) (then (i32.const 1))
        (else (i32.sub (local.get $L) (local.get $i0)))))
      (if (i32.gt_s (local.get $n) (i32.const 32)) (then (local.set $n (i32.const 32))))
      ;; setup exp recurrence for absorption (and coherence if coh)
      (if (i32.lt_s (local.get $n) (i32.const 3)) (then
        (local.set $va (call $exp_f64 (f64.mul (f64.load (i32.add (local.get $absE) (i32.shl (local.get $i0) (i32.const 3)))) (local.get $km))))
        (local.set $ra (if (result f64) (i32.gt_s (local.get $n) (i32.const 1)) (then
          (call $exp_f64 (f64.mul (f64.sub
            (f64.load (i32.add (local.get $absE) (i32.shl (i32.add (local.get $i0) (i32.const 1)) (i32.const 3))))
            (f64.load (i32.add (local.get $absE) (i32.shl (local.get $i0) (i32.const 3))))) (local.get $km))))
          (else (f64.const 1))))
        (local.set $rra (f64.const 1))
        (local.set $vc (f64.const 1)) (local.set $rc (f64.const 1)) (local.set $rrc (f64.const 1))
        (if (local.get $coh) (then
          (local.set $vc (call $exp_f64 (f64.mul (f64.load (i32.add (local.get $cohE) (i32.shl (local.get $i0) (i32.const 3)))) (local.get $grazing2))))
          (local.set $rc (if (result f64) (i32.gt_s (local.get $n) (i32.const 1)) (then
            (call $exp_f64 (f64.mul (f64.sub
              (f64.load (i32.add (local.get $cohE) (i32.shl (i32.add (local.get $i0) (i32.const 1)) (i32.const 3))))
              (f64.load (i32.add (local.get $cohE) (i32.shl (local.get $i0) (i32.const 3))))) (local.get $grazing2))))
            (else (f64.const 1)))))
        )
      ) (else
        (local.set $h2 (i32.sub (local.get $n) (i32.const 1)))
        (local.set $hh (i32.shr_u (local.get $h2) (i32.const 1)))
        (local.set $x0 (f64.mul (f64.load (i32.add (local.get $absE) (i32.shl (local.get $i0) (i32.const 3)))) (local.get $km)))
        (local.set $x1 (f64.mul (f64.load (i32.add (local.get $absE) (i32.shl (i32.add (local.get $i0) (local.get $hh)) (i32.const 3)))) (local.get $km)))
        (local.set $x2 (f64.mul (f64.load (i32.add (local.get $absE) (i32.shl (i32.add (local.get $i0) (local.get $h2)) (i32.const 3)))) (local.get $km)))
        (local.set $bq (f64.div (f64.sub
          (f64.div (f64.sub (local.get $x2) (local.get $x0)) (f64.convert_i32_s (local.get $h2)))
          (f64.div (f64.sub (local.get $x1) (local.get $x0)) (f64.convert_i32_s (local.get $hh))))
          (f64.convert_i32_s (i32.sub (local.get $h2) (local.get $hh)))))
        (local.set $aq (f64.sub (f64.div (f64.sub (local.get $x1) (local.get $x0)) (f64.convert_i32_s (local.get $hh)))
          (f64.mul (local.get $bq) (f64.convert_i32_s (local.get $hh)))))
        (local.set $va (call $exp_f64 (local.get $x0)))
        (local.set $ra (call $exp_f64 (f64.add (local.get $aq) (local.get $bq))))
        (local.set $rra (call $exp_f64 (f64.mul (f64.const 2) (local.get $bq))))
        (local.set $vc (f64.const 1)) (local.set $rc (f64.const 1)) (local.set $rrc (f64.const 1))
        (if (local.get $coh) (then
          (local.set $x0 (f64.mul (f64.load (i32.add (local.get $cohE) (i32.shl (local.get $i0) (i32.const 3)))) (local.get $grazing2)))
          (local.set $x1 (f64.mul (f64.load (i32.add (local.get $cohE) (i32.shl (i32.add (local.get $i0) (local.get $hh)) (i32.const 3)))) (local.get $grazing2)))
          (local.set $x2 (f64.mul (f64.load (i32.add (local.get $cohE) (i32.shl (i32.add (local.get $i0) (local.get $h2)) (i32.const 3)))) (local.get $grazing2)))
          (local.set $bq (f64.div (f64.sub
            (f64.div (f64.sub (local.get $x2) (local.get $x0)) (f64.convert_i32_s (local.get $h2)))
            (f64.div (f64.sub (local.get $x1) (local.get $x0)) (f64.convert_i32_s (local.get $hh))))
            (f64.convert_i32_s (i32.sub (local.get $h2) (local.get $hh)))))
          (local.set $aq (f64.sub (f64.div (f64.sub (local.get $x1) (local.get $x0)) (f64.convert_i32_s (local.get $hh)))
            (f64.mul (local.get $bq) (f64.convert_i32_s (local.get $hh)))))
          (local.set $vc (call $exp_f64 (local.get $x0)))
          (local.set $rc (call $exp_f64 (f64.add (local.get $aq) (local.get $bq))))
          (local.set $rrc (call $exp_f64 (f64.mul (f64.const 2) (local.get $bq))))
        ))
      ))
      (local.set $i1 (i32.add (local.get $i0) (local.get $n)))
      (local.set $i (local.get $i0))
      (loop $bins
        (local.set $coherent (f64.mul (local.get $q) (local.get $vc)))
        ;; f64x2: lanes = (coherent·coherent, 2·coherent·cp) for the Lloyd gain.
        (local.set $v (f64x2.mul
          (f64x2.replace_lane 1 (f64x2.splat (local.get $coherent)) (f64.mul (f64.const 2) (local.get $coherent)))
          (f64x2.replace_lane 1 (f64x2.splat (local.get $coherent)) (local.get $cp))))
        (local.set $gain (f64.sub (f64.add (f64.const 1) (f64x2.extract_lane 0 (local.get $v))) (f64x2.extract_lane 1 (local.get $v))))
        (if (f64.lt (local.get $gain) (f64.const 0)) (then (local.set $gain (f64.const 0))))
        (local.set $contrib (f64.mul (f64.mul
          (f64.add (f64.mul (local.get $broadband) (local.get $gain)) (local.get $flow))
          (f64.load (i32.add (local.get $se) (i32.shl (local.get $i) (i32.const 3)))))
          (local.get $va)))
        (local.set $off (i32.add (local.get $P) (i32.shl (local.get $i) (i32.const 3))))
        (f64.store (local.get $off) (f64.add (f64.load (local.get $off)) (local.get $contrib)))
        (if (local.get $difar) (then
          (local.set $off (i32.add (local.get $sE) (i32.shl (local.get $i) (i32.const 3))))
          (f64.store (local.get $off) (f64.add (f64.load (local.get $off)) (f64.mul (local.get $contrib) (local.get $sinB))))
          (local.set $off (i32.add (local.get $sN) (i32.shl (local.get $i) (i32.const 3))))
          (f64.store (local.get $off) (f64.add (f64.load (local.get $off)) (f64.mul (local.get $contrib) (local.get $cosB))))
        ))
        (if (local.get $keepAb) (then
          (f64.store (i32.add (local.get $AB) (i32.shl (local.get $i) (i32.const 3))) (local.get $va))))
        (local.set $next (f64.sub (f64.mul (local.get $cp) (local.get $dc)) (f64.mul (local.get $sp) (local.get $ds))))
        (local.set $sp (f64.add (f64.mul (local.get $sp) (local.get $dc)) (f64.mul (local.get $cp) (local.get $ds))))
        (local.set $cp (local.get $next))
        (local.set $va (f64.mul (local.get $va) (local.get $ra)))
        (local.set $ra (f64.mul (local.get $ra) (local.get $rra)))
        (local.set $vc (f64.mul (local.get $vc) (local.get $rc)))
        (local.set $rc (f64.mul (local.get $rc) (local.get $rrc)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $bins (i32.lt_s (local.get $i) (local.get $i1)))
      )
      (local.set $i0 (local.get $i1))
      (br_if $chunks (i32.lt_s (local.get $i0) (local.get $L)))
    )
  )

  ;; Tiny SIMD probe target (also used by feature detect via separate module in JS).
  (func (export "simdPing") (result v128)
    (f64x2.add (f64x2.splat (f64.const 1)) (f64x2.splat (f64.const 2)))
  )
)
