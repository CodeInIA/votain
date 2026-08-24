import { LegalPage, type LegalSection } from './LegalPage';

const SECTIONS: LegalSection[] = [
  { titleKey: 'terms.what_title',     bodyKeys: ['terms.what_1', 'terms.what_2'] },
  { titleKey: 'terms.binding_title',  bodyKeys: ['terms.binding_1', 'terms.binding_2'] },
  { titleKey: 'terms.identity_title', bodyKeys: ['terms.identity_1', 'terms.identity_2'] },
  { titleKey: 'terms.organizer_title', bodyKeys: ['terms.organizer_1', 'terms.organizer_2'] },
  { titleKey: 'terms.warranty_title', bodyKeys: ['terms.warranty_1', 'terms.warranty_2'] },
  { titleKey: 'terms.licence_title',  bodyKeys: ['terms.licence_1'] },
];

export default function Terms() {
  return <LegalPage titleKey="terms.title" updatedKey="terms.updated" sections={SECTIONS} />;
}
