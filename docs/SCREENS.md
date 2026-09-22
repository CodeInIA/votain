# Every screen

Each one at 1280×832 and at 448×997, a Pixel 9 Pro XL.

These are **real**, not mock-ups and not the demo dataset: a local Hardhat node with the
contracts deployed on it, twelve elections spread across the lifecycle, and enrolments and
ballots that were actually cast. The elections are in Spanish because the seeding script
names them after the case each one exercises. The interface is in Spanish here too; it ships
in 13 languages.

Nothing is on Polygon Amoy yet, so none of this has faced a public chain.

> The top bar in every capture shows **Votante | Organizador**. That is one browser holding
> both sessions at once, which the app supports on purpose: the same person can run an
> election and vote in someone else's. The switch decides which hat is on, and the profile
> icon, the menu and the colour of every heading follow it.


## Public

No session needed. This is what anybody sees, including a voter who has not signed in.

### Elections

The public catalogue. Every election on the registry, with its rule, its deadline, how many are enrolled and how many have voted.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/discover.webp" alt="Elections, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/discover.webp" alt="Elections, mobile"></td>
  </tr>
</table>

### An election

Its three phases dated, the quorum it has to clear, and a badge saying it was verified against the chain.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/election.webp" alt="An election, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/election.webp" alt="An election, mobile"></td>
  </tr>
</table>

### Results

Published totals, per option, once the homomorphic sum has been decrypted and written back on chain.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/results.webp" alt="Results, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/results.webp" alt="Results, mobile"></td>
  </tr>
</table>

### Verify a vote

Anyone, signed in or not, can check a receipt against the chain without learning who cast it.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/verify-receipt.webp" alt="Verify a vote, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/verify-receipt.webp" alt="Verify a vote, mobile"></td>
  </tr>
</table>

### How it works

What the system promises a voter and how each promise is kept.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/how-it-works.webp" alt="How it works, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/how-it-works.webp" alt="How it works, mobile"></td>
  </tr>
</table>

### Terms

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/terms.webp" alt="Terms, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/terms.webp" alt="Terms, mobile"></td>
  </tr>
</table>

### Privacy

What the chain shows, what it does not, and what an observer could still infer.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/privacy.webp" alt="Privacy, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/privacy.webp" alt="Privacy, mobile"></td>
  </tr>
</table>

## Voter

Behind a World ID session. The identity itself never leaves the device.

### My elections

The ones this voter may take part in, with what each one is waiting for.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/voter-elections.webp" alt="My elections, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/voter-elections.webp" alt="My elections, mobile"></td>
  </tr>
</table>

### History

Their own ballots, read back from the chain by a nullifier only they can compute.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/voter-history.webp" alt="History, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/voter-history.webp" alt="History, mobile"></td>
  </tr>
</table>

### Saved

Bookmarks, encrypted under a key derived from the voter’s own secret and stored on chain, so the registry holds a list nobody but them can read.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/voter-saved.webp" alt="Saved, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/voter-saved.webp" alt="Saved, mobile"></td>
  </tr>
</table>

### Profile

The anonymous identifier, the generated pattern, the twelve-word recovery phrase and every passkey that opens it.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/voter-profile.webp" alt="Profile, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/voter-profile.webp" alt="Profile, mobile"></td>
  </tr>
</table>

## Organizer

Behind a wallet. Every change here is a transaction they sign.

### Dashboard

Their elections, the people enrolled across them, and the gas tank that pays for the votes.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/organizer-dashboard.webp" alt="Dashboard, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/organizer-dashboard.webp" alt="Dashboard, mobile"></td>
  </tr>
</table>

### New election

The wizard: rule, calendar, candidates, and who is eligible to take part.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/organizer-new.webp" alt="New election, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/organizer-new.webp" alt="New election, mobile"></td>
  </tr>
</table>

### Managing one

Phase-gated controls. Which deadlines can still move, whether it can still be cancelled, and a way to see the same page as a voter.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/organizer-manage.webp" alt="Managing one, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/organizer-manage.webp" alt="Managing one, mobile"></td>
  </tr>
</table>

### Gas

Deposits, reserves and what each relayed ballot actually cost, priced from past relays rather than assumed.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/organizer-gas.webp" alt="Gas, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/organizer-gas.webp" alt="Gas, mobile"></td>
  </tr>
</table>

### Members

The merkle tree of an election, read from its own enrolment events.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/organizer-members.webp" alt="Members, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/organizer-members.webp" alt="Members, mobile"></td>
  </tr>
</table>

### Saved

The organizer’s own bookmarks, kept separately from the voter’s.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/organizer-saved.webp" alt="Saved, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/organizer-saved.webp" alt="Saved, mobile"></td>
  </tr>
</table>

### Profile

Display name, verified domains, the wallet that signs every change, and the generated pattern.

<table>
  <tr>
    <td width="70%"><img src="screenshots/pc/organizer-profile.webp" alt="Profile, desktop"></td>
    <td width="30%"><img src="screenshots/mobile/organizer-profile.webp" alt="Profile, mobile"></td>
  </tr>
</table>

---

## Not captured here

Screens that only exist mid-flow, and cannot be reached by a URL with a session already
established: signing in with World ID, the twelve-word phrase being handed over for the
first time, linking a passkey, recovering an identity, casting a ballot and the receipt that
follows it. They need the flow that leads to them, and a capture of one taken out of its
flow would show a state the app never actually puts a person in.
