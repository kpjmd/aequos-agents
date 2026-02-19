// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OrthoIQAgentToken
 * @dev ERC20 token for rewarding OrthoIQ AI agents based on medical outcomes
 *
 * Features:
 * - Maximum supply of 1 million tokens
 * - Authorized minter system for agent wallets
 * - Event tracking for transparency
 * - Burn capability for token economics
 */
contract OrthoIQAgentToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18;
    mapping(address => bool) public authorizedMinters;

    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);
    event TokensMinted(address indexed to, uint256 amount, string reason);
    event TokensBurned(address indexed from, uint256 amount);

    /**
     * @dev Constructor mints initial supply to deployer
     */
    constructor() ERC20("OrthoIQ Agent Token", "OAT") Ownable(msg.sender) {
        // Mint initial 100,000 tokens to deployer for agent authorization and testing
        _mint(msg.sender, 100_000 * 10**18);
    }

    /**
     * @dev Authorize an address to mint tokens (typically agent wallets)
     * @param minter Address to authorize
     */
    function authorizeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    /**
     * @dev Revoke minting authorization from an address
     * @param minter Address to revoke
     */
    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    /**
     * @dev Mint tokens to an agent wallet with reason tracking
     * @param to Agent wallet address
     * @param amount Token amount to mint (in wei)
     * @param reason Description of why tokens are being minted
     */
    function mint(address to, uint256 amount, string memory reason) external {
        require(authorizedMinters[msg.sender] || msg.sender == owner(), "Not authorized to mint");
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds maximum supply");

        _mint(to, amount);
        emit TokensMinted(to, amount, reason);
    }

    /**
     * @dev Burn tokens from caller's balance
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount);
    }

    /**
     * @dev Get token balance in human-readable format (without decimals)
     * @param account Address to check
     * @return Balance in whole tokens
     */
    function balanceOfReadable(address account) external view returns (uint256) {
        return balanceOf(account) / 10**18;
    }
}
