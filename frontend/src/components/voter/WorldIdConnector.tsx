/**
 * The World ID handoff: a code to photograph, or a door to walk through.
 *
 * There were two copies of this. One learned that a phone cannot photograph its
 * own screen and grew a deep link into World App; the other never did, and went
 * on printing the raw connector URI under a heading that said "scan this code",
 * describing something that was not there. That is what duplicated blocks do:
 * they do not stay wrong together, they drift, and the copy nobody is looking at
 * is the one a person in trouble reaches.
 *
 * So it lives here once, and both callers render it.
 */
import { useTranslation } from 'react-i18next';
import { ScanLine } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

/** A phone or tablet: the screen that cannot photograph itself. */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

interface WorldIdConnectorProps {
  /** The `wld=` connector URI from IDKit, live for this one verification. */
  uri: string;
  className?: string;
}

export function WorldIdConnector({ uri, className }: WorldIdConnectorProps) {
  const { t } = useTranslation();

  return (
    <div className={`w-full flex flex-col items-center ${className ?? ''}`}>
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
        {t(isMobile ? 'verify.open_title' : 'verify.qr_title')}
      </h2>
      <p className="text-on-surface-variant text-sm mb-6 px-4 text-center">
        {t(isMobile ? 'verify.open_desc' : 'verify.qr_desc')}
      </p>

      {isMobile ? (
        <div className="flex flex-col items-center gap-4 mb-6">
          <a
            href={uri}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-4 bg-white text-black font-semibold rounded-2xl flex items-center gap-3 shadow-lg active:scale-95 transition-transform"
          >
            <img src="/world-id-logo.svg" alt="" className="w-6 h-6" />
            {t('verify.btn_open_app')}
          </a>
          {/* A NOTE UNTIL IT BECAME THE INSTRUCTION. World App used to be handed
              a `return_to`, so this line was a courtesy: it told the voter what
              was about to happen anyway. Nothing brings them back now, so the
              sentence is the only thing standing between a finished
              verification and a voter who never returns to collect it. Grey
              and extra small was the wrong weight for that. */}
          <p className="text-on-surface text-sm text-center leading-relaxed px-4 py-3 rounded-2xl
                        bg-warning/10 border border-warning/20">
            {t('verify.mobile_return_hint')}
          </p>
        </div>
      ) : (
        <div className="p-4 bg-white rounded-2xl shadow-lg mb-6">
          <QRCodeSVG value={uri} size={200} level="M" includeMargin={false} />
        </div>
      )}

      {/* NOT A SPINNER, and that was the whole problem. A turning circle says
          the system is busy and the person should wait, so voters sat and
          watched it while the thing it was waiting for was them. Nothing is
          loading here: the request is open and the page is listening. What is
          missing is a scan, so the line asks for one and the icon is still.

          Hidden on mobile, where the button is the instruction and the hint
          under it already says what happens next. A second line there only
          competed with the one thing to press. */}
      {!isMobile && (
        <div className="flex items-center gap-2 text-on-surface-variant text-xs">
          <ScanLine className="w-4 h-4 shrink-0" />
          <span>{t('verify.qr_waiting')}</span>
        </div>
      )}
    </div>
  );
}
