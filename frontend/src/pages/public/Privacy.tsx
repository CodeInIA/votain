import { LegalPage, type LegalSection } from './LegalPage';

const SECTIONS: LegalSection[] = [
  { titleKey: 'privacy.summary_title',   bodyKeys: ['privacy.summary_1', 'privacy.summary_2'] },
  { titleKey: 'privacy.worldid_title',   bodyKeys: ['privacy.worldid_1', 'privacy.worldid_2'] },
  { titleKey: 'privacy.identity_title',  bodyKeys: ['privacy.identity_1', 'privacy.identity_2'] },
  { titleKey: 'privacy.ballot_title',    bodyKeys: ['privacy.ballot_1', 'privacy.ballot_2'] },
  { titleKey: 'privacy.onchain_title',   bodyKeys: ['privacy.onchain_1', 'privacy.onchain_2'] },
  { titleKey: 'privacy.limits_title',    bodyKeys: ['privacy.limits_1', 'privacy.limits_2'] },
  { titleKey: 'privacy.retention_title', bodyKeys: ['privacy.retention_1', 'privacy.retention_2'] },
];

export default function Privacy() {
  return <LegalPage titleKey="privacy.title" updatedKey="privacy.updated" sections={SECTIONS} />;
}
