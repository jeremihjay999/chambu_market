'use client'

/**
 * LoginPanda — an inline SVG panda that peeks over the top of the login card.
 *
 * States driven by props (all computed in the parent):
 *   idle          — hangs over the card, eyes open, gentle bob
 *   email         — tilts head down, curious
 *   password      — covers both eyes with paws ("I'm not looking")
 *   peek          — peeks through one paw (show-password toggled)
 *   loading       — eyes dart left-right nervously
 *   error         — shakes head, embarrassed
 *   success       — arms shoot up in celebration
 */

export type PandaState = 'idle' | 'email' | 'password' | 'peek' | 'loading' | 'error' | 'success'

interface Props {
  state: PandaState
}

export function LoginPanda({ state }: Props) {
  const isPassword = state === 'password'
  const isPeek     = state === 'peek'
  const isLoading  = state === 'loading'
  const isError    = state === 'error'
  const isSuccess  = state === 'success'
  const isEmail    = state === 'email'

  /* ── derived transforms ─────────────────────────────────────────────── */
  // whole-body vertical bob for idle
  const bodyBob   = (state === 'idle')  ? 'translateY(0px)'  : 'translateY(0px)'

  // head tilt
  const headTilt  = isEmail   ? 'rotate(8deg)'
                  : isError   ? 'rotate(-6deg)'
                  : 'rotate(0deg)'

  // left arm (from panda's perspective) covers left eye
  const leftArmY  = (isPassword || isPeek) ? '-38px' : '0px'
  const leftArmX  = (isPassword || isPeek) ? '10px'  : '0px'

  // right arm covers right eye; in peek mode stays slightly open
  const rightArmY = (isPassword)           ? '-38px'
                  : (isPeek)               ? '-28px'
                  : '0px'
  const rightArmX = (isPassword)           ? '-10px'
                  : (isPeek)               ? '-6px'
                  : '0px'

  // success — arms fly up
  const successArmL = isSuccess ? 'rotate(-60deg) translateY(-10px)' : 'rotate(0deg)'
  const successArmR = isSuccess ? 'rotate(60deg)  translateY(-10px)' : 'rotate(0deg)'

  const transition = 'all 0.35s cubic-bezier(0.34,1.56,0.64,1)'

  return (
    <div
      aria-hidden="true"
      style={{
        width: 110,
        height: 90,
        position: 'absolute',
        top: -72,
        left: '50%',
        transform: 'translateX(-50%)',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      {/* ── CSS animations injected once ──────────────────────────────── */}
      <style>{`
        @keyframes pandaBob {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        @keyframes pandaShake {
          0%,100% { transform: rotate(0deg); }
          20%     { transform: rotate(-8deg); }
          40%     { transform: rotate(8deg); }
          60%     { transform: rotate(-6deg); }
          80%     { transform: rotate(6deg); }
        }
        @keyframes eyeDart {
          0%,100% { transform: translateX(0); }
          25%     { transform: translateX(-3px); }
          75%     { transform: translateX(3px); }
        }
        @keyframes successBounce {
          0%,100% { transform: translateY(0) scale(1); }
          40%     { transform: translateY(-8px) scale(1.05); }
        }
      `}</style>

      <svg
        viewBox="0 0 110 90"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          width: '100%',
          height: '100%',
          animation: isError   ? 'pandaShake 0.5s ease-in-out'
                   : isSuccess ? 'successBounce 0.6s ease-in-out'
                   : 'pandaBob 2.4s ease-in-out infinite',
          transformOrigin: 'center bottom',
        }}
      >
        {/* ── EARS ──────────────────────────────────────────────────────── */}
        <circle cx="28" cy="22" r="13" fill="#1a1a1a" />
        <circle cx="82" cy="22" r="13" fill="#1a1a1a" />
        <circle cx="28" cy="22" r="7"  fill="#2d2d2d" />
        <circle cx="82" cy="22" r="7"  fill="#2d2d2d" />

        {/* ── HEAD group (tilts) ─────────────────────────────────────── */}
        <g
          style={{
            transformOrigin: '55px 50px',
            transform: headTilt,
            transition,
          }}
        >
          {/* Head */}
          <ellipse cx="55" cy="50" rx="34" ry="32" fill="white" />
          <ellipse cx="55" cy="50" rx="34" ry="32" fill="none" stroke="#e5e7eb" strokeWidth="1" />

          {/* Eye patches */}
          <ellipse cx="38" cy="43" rx="10" ry="10" fill="#1a1a1a" />
          <ellipse cx="72" cy="43" rx="10" ry="10" fill="#1a1a1a" />

          {/* Eyes — dart left-right when loading */}
          <g style={{
            animation: isLoading ? 'eyeDart 0.7s ease-in-out infinite' : 'none',
          }}>
            <circle cx="38" cy="44" r="5" fill="white" />
            <circle cx="72" cy="44" r="5" fill="white" />
            {/* pupils */}
            <circle cx={isEmail ? 38 : 39} cy="45" r="2.5" fill="#1a1a1a"
              style={{ transition }} />
            <circle cx={isEmail ? 72 : 73} cy="45" r="2.5" fill="#1a1a1a"
              style={{ transition }} />
            {/* eye shine */}
            <circle cx="40" cy="43" r="1.2" fill="white" />
            <circle cx="74" cy="43" r="1.2" fill="white" />
          </g>

          {/* Blush — visible on idle/email/success */}
          {(state === 'idle' || state === 'email' || state === 'success') && (
            <>
              <ellipse cx="26" cy="56" rx="8" ry="5" fill="#fca5a5" opacity="0.5" />
              <ellipse cx="84" cy="56" rx="8" ry="5" fill="#fca5a5" opacity="0.5" />
            </>
          )}

          {/* Nose */}
          <ellipse cx="55" cy="55" rx="5" ry="3.5" fill="#1a1a1a" />

          {/* Mouth */}
          <path
            d={
              isSuccess ? 'M 48 62 Q 55 70 62 62'   // big smile
              : isError  ? 'M 48 65 Q 55 60 62 65'   // frown
              : isEmail  ? 'M 49 62 Q 55 67 61 62'   // curious open
              :             'M 49 62 Q 55 66 61 62'  // relaxed
            }
            stroke="#1a1a1a"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            style={{ transition }}
          />

          {/* Tiny teeth on success */}
          {isSuccess && (
            <rect x="51" y="62" width="8" height="4" rx="1" fill="white" />
          )}
        </g>

        {/* ── ARMS — positioned relative to card top ─────────────────── */}
        {/* Left arm */}
        <g style={{
          transformOrigin: '22px 72px',
          transform: isSuccess
            ? successArmL
            : `translate(${leftArmX}, ${leftArmY})`,
          transition,
        }}>
          <ellipse cx="22" cy="76" rx="13" ry="9" fill="#1a1a1a" transform="rotate(-20,22,76)" />
          <ellipse cx="22" cy="76" rx="9"  ry="6" fill="#2d2d2d" transform="rotate(-20,22,76)" />
        </g>

        {/* Right arm */}
        <g style={{
          transformOrigin: '88px 72px',
          transform: isSuccess
            ? successArmR
            : `translate(${rightArmX}, ${rightArmY})`,
          transition,
        }}>
          <ellipse cx="88" cy="76" rx="13" ry="9" fill="#1a1a1a" transform="rotate(20,88,76)" />
          <ellipse cx="88" cy="76" rx="9"  ry="6" fill="#2d2d2d" transform="rotate(20,88,76)" />
        </g>

        {/* ── PEEK indicator — small eye visible between right paw ─── */}
        {isPeek && (
          <circle cx="74" cy="44" r="4" fill="white" style={{ transition }}>
            <animate attributeName="opacity" values="0;1" dur="0.2s" fill="freeze" />
          </circle>
        )}
      </svg>
    </div>
  )
}
