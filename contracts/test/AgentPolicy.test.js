const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const usd = (n) => ethers.parseUnits(String(n), 6);
const TOPUP = 0;
const TRADE = 1;

describe("AgentPolicy", () => {
  let usdc, policy, owner, agent, stranger;

  beforeEach(async () => {
    [owner, agent, stranger] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    // per-request cap $50, daily cap $100, human approval at $20+
    policy = await (await ethers.getContractFactory("AgentPolicy")).deploy(
      await usdc.getAddress(), agent.address, usd(50), usd(100), usd(20)
    );
    await usdc.mint(await policy.getAddress(), usd(200));
    await policy.setTarget("GEMI-FEDJAN26-DN25", true);
  });

  it("auto-approves a small top-up and sends USDC to the agent", async () => {
    await expect(policy.connect(agent).requestSpend(TOPUP, "gateway", usd(1), "data budget"))
      .to.emit(policy, "SpendApproved").withArgs(0, TOPUP, "gateway", usd(1), false);
    expect(await usdc.balanceOf(agent.address)).to.equal(usd(1));
    expect(await policy.remainingToday()).to.equal(usd(99));
  });

  it("auto-approves a small trade without moving USDC", async () => {
    await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(5), "odds look cheap");
    expect((await policy.getRequest(0)).status).to.equal(2); // Approved
    expect(await usdc.balanceOf(agent.address)).to.equal(0);
  });

  it("holds a large trade for human approval", async () => {
    await expect(policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(40), "big edge"))
      .to.emit(policy, "ApprovalRequired");
    expect((await policy.getRequest(0)).status).to.equal(1); // Pending
    expect(await policy.remainingToday()).to.equal(usd(100)); // not counted yet

    await expect(policy.approve(0)).to.emit(policy, "SpendApproved").withArgs(0, TRADE, "GEMI-FEDJAN26-DN25", usd(40), true);
    expect(await policy.remainingToday()).to.equal(usd(60));
  });

  it("lets the owner reject a pending request", async () => {
    await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(40), "big edge");
    await expect(policy.reject(0, "too risky")).to.emit(policy, "SpendRejected").withArgs(0, "too risky");
    await expect(policy.approve(0)).to.be.revertedWithCustomError(policy, "BadStatus");
  });

  it("blocks targets that are not allowlisted", async () => {
    await expect(policy.connect(agent).requestSpend(TRADE, "SOME-OTHER-MARKET", usd(1), "x"))
      .to.be.revertedWithCustomError(policy, "TargetNotAllowed");
  });

  it("enforces the per-request cap", async () => {
    await expect(policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(51), "x"))
      .to.be.revertedWithCustomError(policy, "OverPerRequestCap");
  });

  it("enforces the daily cap, and resets the next day", async () => {
    for (let i = 0; i < 6; i++) {
      await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(15), "x");
    }
    // 90 spent; 15 more would be 105
    await expect(policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(15), "x"))
      .to.be.revertedWithCustomError(policy, "OverDailyCap");
    await time.increase(24 * 60 * 60);
    await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(15), "x");
  });

  it("re-checks the daily cap when a human approves late", async () => {
    await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(40), "big");
    for (let i = 0; i < 5; i++) {
      await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(15), "x");
    }
    // 75 spent; approving 40 would make 115
    await expect(policy.approve(0)).to.be.revertedWithCustomError(policy, "OverDailyCap");
  });

  it("records execution only for approved requests", async () => {
    await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(40), "big");
    await expect(policy.connect(agent).recordExecution(0, "order-1"))
      .to.be.revertedWithCustomError(policy, "BadStatus");
    await policy.approve(0);
    await expect(policy.connect(agent).recordExecution(0, "order-1"))
      .to.emit(policy, "SpendExecuted").withArgs(0, "order-1");
  });

  it("only the agent can request, only the owner can approve", async () => {
    await expect(policy.connect(stranger).requestSpend(TOPUP, "gateway", usd(1), "x"))
      .to.be.revertedWithCustomError(policy, "NotAgent");
    await policy.connect(agent).requestSpend(TRADE, "GEMI-FEDJAN26-DN25", usd(40), "big");
    await expect(policy.connect(agent).approve(0)).to.be.revertedWithCustomError(policy, "NotOwner");
  });

  it("kill switch stops everything", async () => {
    await policy.setPaused(true);
    await expect(policy.connect(agent).requestSpend(TOPUP, "gateway", usd(1), "x"))
      .to.be.revertedWithCustomError(policy, "IsPaused");
  });

  it("owner can withdraw the budget", async () => {
    await policy.withdraw(usd(200));
    expect(await usdc.balanceOf(owner.address)).to.equal(usd(200));
  });
});
