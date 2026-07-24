import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/Card';
import { Input, Textarea, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { RadioGroup } from '../../components/ui/RadioCard';
import { Switch } from '../../components/ui/Switch';
import { Skeleton, SkeletonCard } from '../../components/ui/Skeleton';
import { Spinner, ProgressDots } from '../../components/ui/Spinner';
import { Stepper, OverlayStepper } from '../../components/ui/Stepper';
import { Countdown } from '../../components/ui/Countdown';
import { ResultBarChart } from '../../components/ui/BarChart';
import { Avatar, IdentityCommitment } from '../../components/ui/Avatar';
import { LanguageSelector } from '../../components/ui/LanguageSelector';
import { EligibilityRow } from '../../components/ui/EligibilityRow';
import { GasWidget } from '../../components/ui/GasWidget';
import { BlockchainBadge, IPFSBadge } from '../../components/ui/BlockchainBadge';
import { TransactionPendingModal, type TxState } from '../../components/ui/TransactionPendingModal';
import { ToastProvider } from '../../components/ui/Toast';
import { useToast } from '../../components/ui/useToast';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-xs font-bold uppercase tracking-widest text-on-surface-meta mb-4 pb-2 border-b border-white/5">
        {title}
      </h2>
      <div className="flex flex-wrap gap-3 items-start">{children}</div>
    </section>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="default" onClick={() => toast({ title: 'Success!', description: 'Your vote was recorded.', variant: 'success' })}>
        Toast success
      </Button>
      <Button size="sm" variant="default" onClick={() => toast({ title: 'Error', description: 'Something went wrong.', variant: 'error' })}>
        Toast error
      </Button>
      <Button size="sm" variant="default" onClick={() => toast({ title: 'Warning', description: 'Gas balance is low.', variant: 'warning' })}>
        Toast warning
      </Button>
      <Button size="sm" variant="default" onClick={() => toast({ title: 'Info', variant: 'info', description: 'Verification pending.' })}>
        Toast info
      </Button>
    </div>
  );
}

const SAMPLE_RESULTS = [
  { name: 'Alice Johnson', votes: 847, isWinner: true },
  { name: 'Bob Martinez', votes: 612, isTie: false },
  { name: 'Carol Smith', votes: 391 },
  { name: 'Blank Vote', votes: 150 },
];

export default function ComponentsShowcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const [radioVal, setRadioVal] = useState('alice');
  const [switched, setSwitched] = useState(false);
  const [dotsStep, setDotsStep] = useState(1);
  const [inputVal, setInputVal] = useState('');
  const [txState, setTxState] = useState<TxState>('idle');

  // Snapshot once so render stays pure (showcase demo dates).
  const [futureDate] = useState(() => new Date(Date.now() + 45 * 60_000));
  const [urgentDate] = useState(() => new Date(Date.now() + 20 * 60_000));

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-background text-on-surface font-body p-8 max-w-5xl mx-auto">
        <h1 className="text-3xl font-black tracking-tighter text-white mb-2">Design System</h1>
        <p className="text-on-surface-variant text-sm mb-10">H1 Component Showcase — DEV only</p>

        <Section title="Buttons">
          <Button variant="gradient">Gradient</Button>
          <Button variant="default">Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="gradient" disabled>Disabled</Button>
          <Button variant="gradient" size="sm">Small</Button>
          <Button variant="gradient" size="lg">Large</Button>
        </Section>

        <Section title="Phase Badges">
          <Badge variant="enrolling" dot>Enrolling</Badge>
          <Badge variant="enrolled" dot>Enrolled</Badge>
          <Badge variant="active" dot>Active</Badge>
          <Badge variant="voted" dot>Voted</Badge>
          <Badge variant="tallying" dot>Tallying</Badge>
          <Badge variant="closed" dot>Closed</Badge>
          <Badge variant="voided" dot>Voided</Badge>
          <Badge variant="cancelled" dot>Cancelled</Badge>
          <Badge variant="voter">Verified Voter</Badge>
          <Badge variant="organizer">Organizer</Badge>
          <Badge variant="tie">Tie</Badge>
        </Section>

        <Section title="Transparency Badges">
          <BlockchainBadge href="#" />
          <IPFSBadge href="#" />
          <BlockchainBadge />
          <IPFSBadge />
        </Section>

        <Section title="Cards">
          {(['low', 'mid', 'high'] as const).map(depth => (
            <Card key={depth} depth={depth} className="p-5 w-56">
              <p className="text-xs text-on-surface-meta mb-1">depth="{depth}"</p>
              <p className="text-sm font-medium text-on-surface">Glass Card</p>
            </Card>
          ))}
          <Card className="w-72">
            <CardHeader>
              <CardTitle>Election Card</CardTitle>
              <CardDescription>Full card with header, content, and footer sections.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-on-surface-variant">Card body content goes here.</p>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="gradient">Action</Button>
            </CardFooter>
          </Card>
        </Section>

        <Section title="Inputs">
          <div className="w-64 flex flex-col gap-3">
            <Input
              label="Election name"
              placeholder="Enter election name"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              leftIcon={<Shield className="w-4 h-4" />}
            />
            <Input label="Error state" placeholder="Invalid value" error="This field is required" />
            <Textarea label="Description" placeholder="Describe the election…" rows={3} />
            <Select
              label="Security level"
              options={[
                { value: 'device', label: 'Device verification' },
                { value: 'orb', label: 'Orb verification' },
              ]}
              placeholder="Select level"
            />
          </div>
        </Section>

        <Section title="Radio Card (Candidate Selector)">
          <div className="w-72">
            <RadioGroup
              value={radioVal}
              onChange={setRadioVal}
              options={[
                { value: 'alice', label: 'Alice Johnson', description: 'Progressive Party candidate' },
                { value: 'bob',   label: 'Bob Martinez',  description: 'Conservative Party candidate' },
                { value: 'blank', label: 'Blank Vote / Abstain' },
              ]}
            />
          </div>
        </Section>

        <Section title="Switch">
          <Switch
            checked={switched}
            onChange={setSwitched}
            label="Enable Orb verification"
            description="Requires physical biometric scan"
          />
        </Section>

        <Section title="Skeleton Loaders">
          <Skeleton className="w-32 h-4" />
          <Skeleton className="w-20 h-20" circle />
          <Skeleton lines={3} className="w-48" />
          <SkeletonCard className="w-64" />
        </Section>

        <Section title="Spinner & Progress Dots">
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
          <div className="flex flex-col gap-2 items-start">
            <ProgressDots total={6} current={dotsStep} onDotClick={setDotsStep} />
            <p className="text-xs text-on-surface-meta">Step {dotsStep + 1} of 6 (click dots)</p>
          </div>
        </Section>

        <Section title="Steppers">
          <div className="w-full">
            <Stepper
              current={1}
              steps={[
                { label: 'Info' },
                { label: 'Timeline' },
                { label: 'Candidates' },
                { label: 'Deploy' },
              ]}
              className="mb-6"
            />
            <OverlayStepper
              steps={[
                { label: 'Preparing your private vote…', status: 'done' },
                { label: 'Sending your vote securely…',  status: 'active' },
                { label: 'Your vote is confirmed!',      status: 'pending' },
              ]}
            />
          </div>
        </Section>

        <Section title="Countdown">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-on-surface-meta w-20">Normal:</span>
              <Countdown deadline={futureDate} size="md" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-on-surface-meta w-20">Urgent (&lt;1h):</span>
              <Countdown deadline={urgentDate} size="md" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-on-surface-meta w-20">Large:</span>
              <Countdown deadline={futureDate} size="lg" />
            </div>
          </div>
        </Section>

        <Section title="Results Bar Chart">
          <div className="w-full max-w-lg">
            <ResultBarChart
              candidates={SAMPLE_RESULTS}
              totalVotes={SAMPLE_RESULTS.reduce((s, c) => s + c.votes, 0)}
            />
          </div>
        </Section>

        <Section title="Avatar & Identity Commitment">
          <Avatar size="xs" fallback="AJ" />
          <Avatar size="sm" fallback="BM" />
          <Avatar size="md" fallback="CS" />
          <Avatar size="lg" fallback="VT" />
          <IdentityCommitment
            commitment="0x1234567890abcdef1234567890abcdef12345678"
            copyable
          />
        </Section>

        <Section title="Language Selector">
          <LanguageSelector />
          <LanguageSelector align="left" />
        </Section>

        <Section title="Eligibility Checklist">
          <div className="w-72 bg-surface-low/40 rounded-2xl px-4 py-2">
            <EligibilityRow label="Age ≥ 18 years" status="met" />
            <EligibilityRow label="EU residency" status="not-met" description="You must be an EU resident to participate." />
            <EligibilityRow label="Orb verification" status="unknown" description="Requires biometric scan at a World ID orb." />
          </div>
        </Section>

        <Section title="Gas Balance Widget">
          <GasWidget balance={2.5} estimatedVotesLeft={84} className="w-72" />
          <GasWidget balance={0.5} estimatedVotesLeft={16} onDeposit={() => {}} className="w-72" />
          <GasWidget balance={0.05} estimatedVotesLeft={2} onDeposit={() => {}} className="w-72" />
        </Section>

        <Section title="Modal">
          <Button variant="default" onClick={() => setModalOpen(true)}>Open Modal</Button>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Confirm action"
            description="This action cannot be undone. Are you sure you want to proceed?"
          >
            <div className="flex gap-3 mt-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
              <Button variant="gradient" onClick={() => setModalOpen(false)} className="flex-1">Confirm</Button>
            </div>
          </Modal>
        </Section>

        <Section title="Transaction Pending Modal">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setTxState('pending')}>Show Pending</Button>
            <Button onClick={() => setTxState('success')}>Show Success</Button>
            <Button onClick={() => setTxState('failed')}>Show Failed</Button>
          </div>
          <TransactionPendingModal
            state={txState}
            txHash={txState === 'success' ? '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' : undefined}
            errorMessage={txState === 'failed' ? 'Transaction reverted: insufficient gas' : undefined}
            onClose={() => setTxState('idle')}
            onRetry={() => { setTxState('pending'); setTimeout(() => setTxState('success'), 2000); }}
          />
        </Section>

        <Section title="Toast Notifications">
          <ToastDemo />
        </Section>
      </div>
    </ToastProvider>
  );
}
