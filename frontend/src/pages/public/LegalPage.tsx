import { useTranslation } from 'react-i18next';

import { usePageMeta } from '../../seo/usePageMeta';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';

/** Shared shell for the Terms and Privacy pages. */
export interface LegalSection {
  titleKey: string;
  bodyKeys: string[];
}

export function LegalPage({
  titleKey,
  updatedKey,
  sections,
}: {
  titleKey: string;
  updatedKey: string;
  sections: LegalSection[];
}) {
  const { t } = useTranslation();
  usePageMeta({ title: t(titleKey) });

  return (
    <PageLayout role="public" showNav showFooter>
      <div className="max-w-3xl mx-auto pt-10 pb-16">
        <h1 className="text-3xl font-black tracking-tight text-white mb-2">{t(titleKey)}</h1>
        <p className="text-xs text-on-surface-meta mb-8">{t(updatedKey)}</p>

        <div className="flex flex-col gap-6">
          {sections.map(section => (
            <Card key={section.titleKey} className="p-6">
              <h2 className="text-base font-semibold text-on-surface mb-3">{t(section.titleKey)}</h2>
              <div className="flex flex-col gap-3">
                {section.bodyKeys.map(key => (
                  <p key={key} className="text-sm text-on-surface-variant leading-relaxed">
                    {t(key)}
                  </p>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
