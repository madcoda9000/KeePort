using KeePort.Api.Services;

namespace KeePort.Api.Data;

/// <summary>What the signed-in user may do when sharing, for the web vault's share dialog.</summary>
/// <param name="Enabled">Whether the user may share at all.</param>
/// <param name="MaxDays">The longest validity in days.</param>
/// <param name="MaxViews">The most views.</param>
/// <param name="RequirePassword">Whether a recipient password is required.</param>
/// <param name="AllowEmail">Whether KeePort can e-mail the link (allowed and e-mail set up).</param>
/// <param name="AllowEmailCode">Whether the recipient can be asked for an e-mail code (allowed and e-mail set up).</param>
/// <param name="BlockedVaultIds">The user's vaults that may not be shared from.</param>
public sealed record SharePolicyDto(bool Enabled, int MaxDays, int MaxViews, bool RequirePassword, bool AllowEmail, bool AllowEmailCode, IReadOnlyList<string> BlockedVaultIds);

/// <summary>A new share as the browser sends it: only encrypted data and settings, never the key.</summary>
/// <param name="VaultFileId">The vault the entry comes from.</param>
/// <param name="EntryUuid">The entry's UUID.</param>
/// <param name="Label">The label for the share lists.</param>
/// <param name="Ciphertext">The encrypted secret, Base64.</param>
/// <param name="Iv">The AES-GCM nonce, Base64.</param>
/// <param name="KdfSalt">The key-derivation salt, Base64.</param>
/// <param name="KdfParams">The Argon2 parameters when a recipient password is set, otherwise null.</param>
/// <param name="Proof">The access proof derived from the key, Base64url; the server stores only its hash.</param>
/// <param name="MaxViews">How often the secret can be opened.</param>
/// <param name="ExpiresInHours">How long the share is valid.</param>
/// <param name="RecipientEmail">The recipient's address, for sending the link or a code.</param>
/// <param name="RequireEmailCode">Whether the recipient must confirm the address with a code.</param>
public sealed record CreateShareRequest(
    string VaultFileId,
    string EntryUuid,
    string Label,
    string Ciphertext,
    string Iv,
    string KdfSalt,
    string? KdfParams,
    string Proof,
    int MaxViews,
    int ExpiresInHours,
    string? RecipientEmail,
    bool RequireEmailCode);

/// <summary>
/// The key for the link KeePort e-mails to the recipient (way B). KeePort builds the link from the web vault address,
/// the share's ID and this key; the key is only in the queued e-mail, which is deleted once it is sent.
/// </summary>
/// <param name="Key">The link key, Base64url of 32 bytes.</param>
public sealed record SendShareRequest(string Key);

/// <summary>A share in the owner's and the administrator's lists: metadata only.</summary>
/// <param name="Id">The share's ID.</param>
/// <param name="Label">The owner's label.</param>
/// <param name="OwnerName">The owner's username.</param>
/// <param name="VaultName">The vault the entry came from.</param>
/// <param name="CreatedAt">When it was created.</param>
/// <param name="ExpiresAt">When it ends.</param>
/// <param name="MaxViews">How often it can be opened.</param>
/// <param name="ViewCount">How often it was opened.</param>
/// <param name="Status">active, used, expired, revoked or locked.</param>
/// <param name="HasPassword">Whether the recipient needs a password.</param>
/// <param name="RecipientEmail">The recipient's address, if one was given.</param>
/// <param name="RequireEmailCode">Whether the recipient must confirm the address.</param>
/// <param name="SentByEmail">Whether KeePort e-mailed the link.</param>
/// <param name="LastViewedAt">When it was last opened.</param>
public sealed record ShareDto(
    string Id,
    string Label,
    string OwnerName,
    string? VaultName,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    int MaxViews,
    int ViewCount,
    string Status,
    bool HasPassword,
    string? RecipientEmail,
    bool RequireEmailCode,
    bool SentByEmail,
    DateTimeOffset? LastViewedAt);

/// <summary>What the recipient page shows before the secret is revealed.</summary>
/// <param name="SenderName">The username of the person who shared it.</param>
/// <param name="ExpiresAt">When the share ends.</param>
/// <param name="ViewsLeft">How often it can still be opened.</param>
/// <param name="HasPassword">Whether a password is needed.</param>
/// <param name="KdfSalt">The key-derivation salt, Base64.</param>
/// <param name="KdfParams">The Argon2 parameters, or null without password.</param>
/// <param name="RequiresEmailCode">Whether a code sent by e-mail is needed.</param>
/// <param name="EmailHint">The masked recipient address the code goes to.</param>
public sealed record ShareMetaDto(string SenderName, DateTimeOffset ExpiresAt, int ViewsLeft, bool HasPassword, string KdfSalt, string? KdfParams, bool RequiresEmailCode, string? EmailHint);

/// <summary>The recipient's request to reveal a secret.</summary>
/// <param name="Proof">The access proof derived from the key and the optional password.</param>
/// <param name="Code">The code from the e-mail, when one is needed.</param>
public sealed record RevealShareRequest(string? Proof, string? Code);

/// <summary>The encrypted secret handed to the recipient's browser.</summary>
/// <param name="Ciphertext">The ciphertext, Base64.</param>
/// <param name="Iv">The nonce, Base64.</param>
/// <param name="ViewsLeft">How often it can still be opened afterwards.</param>
public sealed record RevealShareDto(string Ciphertext, string Iv, int ViewsLeft);

/// <summary>Everything the admin console shows about sharing.</summary>
/// <param name="Settings">The sharing rules.</param>
/// <param name="EmailConfigured">Whether e-mail is set up, which ways B and C need.</param>
/// <param name="Users">Each user's sharing mode.</param>
/// <param name="Vaults">Each vault's sharing switch.</param>
/// <param name="Shares">The shares, newest first.</param>
public sealed record AdminSharingDto(ShareSettings Settings, bool EmailConfigured, IReadOnlyList<ShareUserAccessDto> Users, IReadOnlyList<ShareVaultAccessDto> Vaults, IReadOnlyList<ShareDto> Shares);

/// <summary>A user's sharing mode in the admin console.</summary>
/// <param name="Id">The account's ID.</param>
/// <param name="Username">The account's name.</param>
/// <param name="Mode">default, allowed or blocked.</param>
/// <param name="MayShare">Whether the account may share with the current settings.</param>
public sealed record ShareUserAccessDto(string Id, string Username, string Mode, bool MayShare);

/// <summary>A vault's sharing switch in the admin console.</summary>
/// <param name="Id">The vault's ID.</param>
/// <param name="Name">The vault's name.</param>
/// <param name="Allowed">Whether its entries may be shared.</param>
public sealed record ShareVaultAccessDto(string Id, string Name, bool Allowed);

/// <summary>Sets a user's sharing mode.</summary>
/// <param name="Mode">default, allowed or blocked.</param>
public sealed record SetShareUserModeRequest(string Mode);

/// <summary>Allows or forbids sharing from a vault.</summary>
/// <param name="Allowed">Whether its entries may be shared.</param>
public sealed record SetShareVaultRequest(bool Allowed);
