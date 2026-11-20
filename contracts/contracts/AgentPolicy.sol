// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AgentPolicy
/// @notice The rulebook for an AI trading agent. A human owner sets the limits;
///         the agent must ask this contract before every spend. Every request,
///         approval and execution is logged as an event (QuickNode Streams listens to these).
///
/// Two kinds of spend:
///  - TOPUP: the agent asks for USDC to refill its x402 data budget. On approval,
///           this contract sends real USDC from its balance to the agent's wallet.
///  - TRADE: the agent asks permission to place a Gemini prediction-market order.
///           No USDC moves onchain (Gemini is offchain), but the trade service refuses
///           to place any order whose request is not Approved here.
contract AgentPolicy {
    using SafeERC20 for IERC20;

    enum Kind { TOPUP, TRADE }
    enum Status { None, Pending, Approved, Rejected, Executed }

    struct Request {
        Kind kind;
        Status status;
        uint64 createdAt;
        uint256 amount;     // USDC, 6 decimals
        string target;      // "gateway" for TOPUP, market symbol for TRADE
        string reason;      // the agent's one-line justification
        string executionRef; // Gemini order id, etc. (set after execution)
    }

    IERC20 public immutable usdc;
    address public owner;
    address public agent;
    bool public paused;

    uint256 public perRequestCap;     // max amount for a single request
    uint256 public dailyCap;          // max total approved per UTC day
    uint256 public approvalThreshold; // at or above this, a human must approve

    mapping(uint256 => uint256) public spentOnDay; // day index => amount approved
    mapping(bytes32 => bool) public allowedTarget; // keccak256(target) => allowed
    mapping(address => bool) public allowedSeller; // x402 data sellers the agent may pay

    Request[] private _requests;

    event SpendRequested(uint256 indexed id, Kind kind, string target, uint256 amount, string reason);
    event ApprovalRequired(uint256 indexed id, Kind kind, string target, uint256 amount, string reason);
    event SpendApproved(uint256 indexed id, Kind kind, string target, uint256 amount, bool byHuman);
    event SpendRejected(uint256 indexed id, string why);
    event SpendExecuted(uint256 indexed id, string executionRef);
    event LimitsChanged(uint256 perRequestCap, uint256 dailyCap, uint256 approvalThreshold);
    event TargetAllowed(string target, bool allowed);
    event SellerAllowed(address seller, bool allowed);
    event Paused(bool paused);
    event AgentChanged(address agent);

    error NotOwner();
    error NotAgent();
    error IsPaused();
    error TargetNotAllowed();
    error OverPerRequestCap();
    error OverDailyCap();
    error BadStatus();
    error ZeroAmount();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyAgent() { if (msg.sender != agent) revert NotAgent(); _; }
    modifier notPaused() { if (paused) revert IsPaused(); _; }

    constructor(
        address usdc_,
        address agent_,
        uint256 perRequestCap_,
        uint256 dailyCap_,
        uint256 approvalThreshold_
    ) {
        usdc = IERC20(usdc_);
        owner = msg.sender;
        agent = agent_;
        perRequestCap = perRequestCap_;
        dailyCap = dailyCap_;
        approvalThreshold = approvalThreshold_;
        allowedTarget[keccak256(bytes("gateway"))] = true;
        emit LimitsChanged(perRequestCap_, dailyCap_, approvalThreshold_);
        emit TargetAllowed("gateway", true);
    }

    // ---------------------------------------------------------------- agent

    /// @notice The agent asks to spend. Small requests are approved instantly;
    ///         large ones wait for the owner.
    function requestSpend(Kind kind, string calldata target, uint256 amount, string calldata reason)
        external
        onlyAgent
        notPaused
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        if (!allowedTarget[keccak256(bytes(target))]) revert TargetNotAllowed();
        if (amount > perRequestCap) revert OverPerRequestCap();
        if (spentOnDay[today()] + amount > dailyCap) revert OverDailyCap();

        id = _requests.length;
        _requests.push(Request(kind, Status.Pending, uint64(block.timestamp), amount, target, reason, ""));
        emit SpendRequested(id, kind, target, amount, reason);

        if (amount >= approvalThreshold) {
            emit ApprovalRequired(id, kind, target, amount, reason);
        } else {
            _approve(id, false);
        }
    }

    /// @notice The agent records what it did with an approved request (e.g. the Gemini order id).
    function recordExecution(uint256 id, string calldata executionRef) external onlyAgent {
        Request storage r = _requests[id];
        if (r.status != Status.Approved) revert BadStatus();
        r.status = Status.Executed;
        r.executionRef = executionRef;
        emit SpendExecuted(id, executionRef);
    }

    // ---------------------------------------------------------------- owner

    function approve(uint256 id) external onlyOwner notPaused {
        Request storage r = _requests[id];
        if (r.status != Status.Pending) revert BadStatus();
        // Re-check the daily cap: other spends may have landed since the request.
        if (spentOnDay[today()] + r.amount > dailyCap) revert OverDailyCap();
        _approve(id, true);
    }

    function reject(uint256 id, string calldata why) external onlyOwner {
        Request storage r = _requests[id];
        if (r.status != Status.Pending) revert BadStatus();
        r.status = Status.Rejected;
        emit SpendRejected(id, why);
    }

    function setLimits(uint256 perRequestCap_, uint256 dailyCap_, uint256 approvalThreshold_) external onlyOwner {
        perRequestCap = perRequestCap_;
        dailyCap = dailyCap_;
        approvalThreshold = approvalThreshold_;
        emit LimitsChanged(perRequestCap_, dailyCap_, approvalThreshold_);
    }

    function setTarget(string calldata target, bool allowed) external onlyOwner {
        allowedTarget[keccak256(bytes(target))] = allowed;
        emit TargetAllowed(target, allowed);
    }

    function setSeller(address seller, bool allowed) external onlyOwner {
        allowedSeller[seller] = allowed;
        emit SellerAllowed(seller, allowed);
    }

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentChanged(agent_);
    }

    /// @notice Kill switch. Stops all new requests and approvals.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    /// @notice Owner can pull USDC back out of the budget at any time.
    function withdraw(uint256 amount) external onlyOwner {
        usdc.safeTransfer(owner, amount);
    }

    // ---------------------------------------------------------------- views

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function remainingToday() external view returns (uint256) {
        uint256 spent = spentOnDay[today()];
        return spent >= dailyCap ? 0 : dailyCap - spent;
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function requestCount() external view returns (uint256) {
        return _requests.length;
    }

    // ---------------------------------------------------------------- internal

    function _approve(uint256 id, bool byHuman) internal {
        Request storage r = _requests[id];
        r.status = Status.Approved;
        spentOnDay[today()] += r.amount;
        if (r.kind == Kind.TOPUP) {
            usdc.safeTransfer(agent, r.amount);
        }
        emit SpendApproved(id, r.kind, r.target, r.amount, byHuman);
    }
}
