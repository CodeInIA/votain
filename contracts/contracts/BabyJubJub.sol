// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

/// @title BabyJubJub
/// @notice Point addition on Baby Jubjub, the curve the ballot circuit encrypts
/// on, so an election can keep the running sum of every ballot itself.
/// @dev Extended twisted Edwards coordinates (X:Y:Z:T) with x = X/Z, y = Y/Z and
/// xy = T/Z, and the complete add-2008-hwcd formula (Baby Jubjub's d is not a
/// square). An addition costs a handful of mulmods and no inversion; the one
/// inversion a point needs is paid when it is read back as (x, y).
library BabyJubJub {
    /// @dev The BN254 scalar field, which is Baby Jubjub's base field.
    uint256 internal constant Q =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant A = 168700;
    uint256 internal constant D = 168696;

    error NotOnCurve();

    /// @notice The identity, (0, 1), in extended coordinates.
    function identity() internal pure returns (uint256[4] memory p) {
        p[1] = 1;
        p[2] = 1;
    }

    /// @notice An affine point in extended coordinates. Reverts off the curve.
    function fromAffine(uint256 x, uint256 y) internal pure returns (uint256[4] memory p) {
        if (!isOnCurve(x, y)) revert NotOnCurve();
        p[0] = x;
        p[1] = y;
        p[2] = 1;
        p[3] = mulmod(x, y, Q);
    }

    function isOnCurve(uint256 x, uint256 y) internal pure returns (bool) {
        if (x >= Q || y >= Q) return false;
        uint256 xx = mulmod(x, x, Q);
        uint256 yy = mulmod(y, y, Q);
        uint256 lhs = addmod(mulmod(A, xx, Q), yy, Q);
        uint256 rhs = addmod(1, mulmod(D, mulmod(xx, yy, Q), Q), Q);
        return lhs == rhs;
    }

    /// @notice p + q, both in extended coordinates.
    function add(uint256[4] memory p, uint256[4] memory q) internal pure returns (uint256[4] memory r) {
        uint256 a = mulmod(p[0], q[0], Q);
        uint256 b = mulmod(p[1], q[1], Q);
        uint256 c = mulmod(D, mulmod(p[3], q[3], Q), Q);
        uint256 d = mulmod(p[2], q[2], Q);
        // e = (X1 + Y1)(X2 + Y2) - a - b
        uint256 e = addmod(
            mulmod(addmod(p[0], p[1], Q), addmod(q[0], q[1], Q), Q),
            Q - addmod(a, b, Q),
            Q
        );
        uint256 f = addmod(d, Q - c, Q);
        uint256 g = addmod(d, c, Q);
        uint256 h = addmod(b, Q - mulmod(A, a, Q), Q);
        r[0] = mulmod(e, f, Q);
        r[1] = mulmod(g, h, Q);
        r[2] = mulmod(f, g, Q);
        r[3] = mulmod(e, h, Q);
    }

    /// @notice The affine (x, y) of an extended point.
    function toAffine(uint256[4] memory p) internal view returns (uint256 x, uint256 y) {
        uint256 zInv = _inverse(p[2]);
        x = mulmod(p[0], zInv, Q);
        y = mulmod(p[1], zInv, Q);
    }

    /// @dev Fermat inversion through the modexp precompile.
    function _inverse(uint256 value) private view returns (uint256 result) {
        bytes memory input = abi.encode(uint256(32), uint256(32), uint256(32), value, Q - 2, Q);
        (bool ok, bytes memory output) = address(0x05).staticcall(input);
        require(ok && output.length == 32, "modexp failed");
        result = abi.decode(output, (uint256));
    }
}
