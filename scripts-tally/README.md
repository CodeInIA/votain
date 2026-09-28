# scripts-tally/

The off-chain tally, and anyone's check of a published one. The organizer can
also tally in the app; this is the same computation for an offline machine, and
the only path that pins the result JSON to IPFS.

```bash
npm install
cp .env.example .env    # RPC_URL, and for tallying TALLY_KEY_FILE, ORGANIZER_PRIVATE_KEY
npm run tally -- <election> [--publish] [--pin]   # the organizer, holding the keys
npm run tally -- <election> --verify              # anyone, no key
```

It proves with the same tally circuit the browser uses (`CIRCUITS_DIR`, by
default the frontend's copy) and imports the browser's own
`frontend/src/lib/ballotCrypto.ts`, so the two cannot disagree on the
arithmetic.

## What each mode does

```mermaid
flowchart TB
  chain[("ElectionV4 on chain<br/>aggregate, BallotCast events,<br/>published result")]

  subgraph tallymode["tally (organizer)"]
    read["read the aggregate:<br/>each voter's last vote, encrypted"]
    decrypt["decrypt with the tally keys<br/>(exported from the app)"]
    quorum{"voters at or above<br/>the privacy quorum?"}
    prove["prove the decryption<br/>tally circuit, publish mode"]
    provevoid["prove only 'below quorum'<br/>counts never revealed"]
    json["audit JSON, optionally<br/>pinned on IPFS (Pinata)"]
  end

  subgraph verifymode["--verify (anyone)"]
    readall["re-add every BallotCast"]
    same{"sum equals the aggregate<br/>the result was proved against?"}
    reverify["re-check the published proof<br/>against the tally verification key"]
  end

  chain --> read --> decrypt --> quorum
  quorum -- "yes" --> prove --> json -- "publishResults" --> chain
  quorum -- "no" --> provevoid -- "voidBelowQuorum" --> chain
  chain --> readall --> same
  same -- "yes" --> reverify
  same -- "no" --> fail["exit non-zero"]
  reverify -- "fails" --> fail
  reverify -- "holds" --> ok["verified: counts and voter total"]
```

The contract already refuses a result whose proof does not verify; `--verify`
repeats the check independently of the on-chain verifier, from the chain data
alone.
