// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title KMS
 * @notice On-chain lock/key governance for off-chain encrypted assets (MultiSig-KMS).
 * @dev 2-of-3 approver multisig, mapping whitelist, instant revocation, immutable event audit trail.
 */
contract KMS is AccessControl {
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");

    uint256 public constant REQUIRED_APPROVALS = 2;
    uint256 public constant MAX_APPROVERS = 3;

    mapping(address => bool) private _whitelist;

    uint256 private _nextRequestId;

    struct AccessRequest {
        address requester;
        bytes32 documentId;
        uint8 approvalCount;
        bool executed;
        bool exists;
        mapping(address => bool) approvals;
    }

    mapping(uint256 => AccessRequest) private _requests;

    event PermissionGranted(address indexed account, address indexed grantedBy);
    event PermissionRevoked(address indexed target, address indexed revokedBy);
    event AccessRequested(
        uint256 indexed requestId,
        address indexed requester,
        bytes32 indexed documentId
    );
    event AccessApproved(
        uint256 indexed requestId,
        address indexed approver,
        uint8 approvalCount
    );
    event DocumentAccessed(
        uint256 indexed requestId,
        address indexed requester,
        bytes32 indexed documentId
    );
    event DocumentAccessLogged(address indexed accessor, bytes32 indexed documentId);

    error NotWhitelisted(address account);
    error AlreadyWhitelisted(address account);
    error NotWhitelistedForRevoke(address account);
    error InvalidApproverCount();
    error ZeroAddress();
    error RequestNotFound(uint256 requestId);
    error RequestAlreadyExecuted(uint256 requestId);
    error AlreadyApproved(uint256 requestId, address approver);
    error DuplicateApprover(address approver);

    /**
     * @param admin Super administrator (revocation & whitelist management).
     * @param approvers Exactly three distinct approver addresses (2-of-3 threshold).
     */
    constructor(address admin, address[3] memory approvers) {
        if (admin == address(0)) {
            revert ZeroAddress();
        }
        if (
            approvers[0] == address(0) ||
            approvers[1] == address(0) ||
            approvers[2] == address(0)
        ) {
            revert ZeroAddress();
        }
        if (
            approvers[0] == approvers[1] ||
            approvers[0] == approvers[2] ||
            approvers[1] == approvers[2]
        ) {
            revert DuplicateApprover(address(0));
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        for (uint256 i = 0; i < MAX_APPROVERS; ) {
            _grantRole(APPROVER_ROLE, approvers[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Add an address to the decryption-permission whitelist.
     */
    function grantPermission(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (_whitelist[account]) {
            revert AlreadyWhitelisted(account);
        }
        _whitelist[account] = true;
        emit PermissionGranted(account, msg.sender);
    }

    /**
     * @notice Immediately revoke whitelist access (emergency isolation switch).
     */
    function revokePermission(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_whitelist[account]) {
            revert NotWhitelistedForRevoke(account);
        }
        _whitelist[account] = false;
        emit PermissionRevoked(account, msg.sender);
    }

    /**
     * @notice Records on-chain access to a normal (non-multisig) document.
     * @param documentId Off-chain asset identifier (audit trail only; no approval flow).
     */
    function logDocumentAccess(bytes32 documentId) external {
        if (!_whitelist[msg.sender]) {
            revert NotWhitelisted(msg.sender);
        }
        emit DocumentAccessLogged(msg.sender, documentId);
    }

    /**
     * @notice Whitelisted party initiates an on-chain decryption-access request (secure documents).
     * @param documentId Off-chain asset identifier (e.g. hash of Encrypted_Log.dat metadata).
     */
    function requestDocumentAccess(bytes32 documentId) external returns (uint256 requestId) {
        if (!_whitelist[msg.sender]) {
            revert NotWhitelisted(msg.sender);
        }

        requestId = _nextRequestId;
        unchecked {
            ++_nextRequestId;
        }

        AccessRequest storage req = _requests[requestId];
        req.requester = msg.sender;
        req.documentId = documentId;
        req.exists = true;

        emit AccessRequested(requestId, msg.sender, documentId);
    }

    /**
     * @notice Approver co-signs a pending request; at 2 approvals access is granted on-chain.
     */
    function approveAccess(uint256 requestId) external onlyRole(APPROVER_ROLE) {
        AccessRequest storage req = _requests[requestId];
        if (!req.exists) {
            revert RequestNotFound(requestId);
        }
        if (req.executed) {
            revert RequestAlreadyExecuted(requestId);
        }
        if (req.approvals[msg.sender]) {
            revert AlreadyApproved(requestId, msg.sender);
        }

        req.approvals[msg.sender] = true;
        unchecked {
            ++req.approvalCount;
        }

        emit AccessApproved(requestId, msg.sender, req.approvalCount);

        if (req.approvalCount >= REQUIRED_APPROVALS) {
            req.executed = true;
            emit DocumentAccessed(requestId, req.requester, req.documentId);
        }
    }

    function isWhitelisted(address account) external view returns (bool) {
        return _whitelist[account];
    }

    function getRequest(
        uint256 requestId
    )
        external
        view
        returns (
            address requester,
            bytes32 documentId,
            uint8 approvalCount,
            bool executed,
            bool exists
        )
    {
        AccessRequest storage req = _requests[requestId];
        return (req.requester, req.documentId, req.approvalCount, req.executed, req.exists);
    }

    function hasApproved(uint256 requestId, address approver) external view returns (bool) {
        return _requests[requestId].approvals[approver];
    }

    function nextRequestId() external view returns (uint256) {
        return _nextRequestId;
    }
}
