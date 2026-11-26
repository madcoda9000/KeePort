using System.Globalization;
using System.Net;
using System.Text;

namespace KeePort.Api.Services;

/// <summary>A rendered e-mail.</summary>
/// <param name="Subject">The subject line.</param>
/// <param name="Text">The plain-text body.</param>
/// <param name="Html">The HTML body.</param>
public sealed record RenderedEmail(string Subject, string Text, string Html);

/// <summary>
/// The e-mails KeePort sends, in English, German and French. E-mails never contain passwords or vault content; links
/// carry only one-time tokens. Placeholders such as {code} are filled in and HTML-encoded.
/// </summary>
public static class EmailTemplates
{
    /// <summary>The template names.</summary>
    public static class Kinds
    {
        public const string Test = "test";
        public const string Verify = "verify";
        public const string Invite = "invite";
        public const string Reset = "reset";
        public const string SignIn = "signIn";
        public const string PasswordChangedSelf = "passwordChangedSelf";
        public const string PasswordChangedAdmin = "passwordChangedAdmin";
        public const string PasswordChangedReset = "passwordChangedReset";
        public const string EmailChanged = "emailChanged";
        public const string AppPassword = "appPassword";
        public const string WarnFailedSignIns = "warnFailedSignIns";
        public const string WarnCertificate = "warnCertificate";
        public const string WarnStorage = "warnStorage";
        public const string WarnDiskSpace = "warnDiskSpace";
        public const string MfaCode = "mfaCode";
        public const string MfaEnabled = "mfaEnabled";
        public const string MfaDisabled = "mfaDisabled";
        public const string MfaReset = "mfaReset";
    }

    private const string NotYou = "notYou";

    private static readonly Dictionary<string, Dictionary<string, string>> Texts = new()
    {
        ["en"] = new()
        {
            ["greeting"] = "Hello {username},",
            ["greetingAdmin"] = "Hello,",
            ["footer"] = "This e-mail was sent by KeePort ({site}). Please do not reply to it.",
            [NotYou] = "If this was not you, change your account password right away and tell your administrator.",
            ["test.subject"] = "KeePort test e-mail",
            ["test.body"] = "This is a test e-mail from KeePort. If you can read it, sending e-mail works.",
            ["verify.subject"] = "Your KeePort verification code",
            ["verify.body"] = "Enter this code in KeePort to confirm your e-mail address. It is valid for 30 minutes.",
            ["verify.ignore"] = "If you did not ask for it, you can ignore this e-mail.",
            ["invite.subject"] = "You have been invited to KeePort",
            ["invite.body"] = "{inviter} created a KeePort account for you with the username {username}. Choose your password with the button below. The link is valid for 48 hours and works once.",
            ["invite.button"] = "Choose password",
            ["invite.after"] = "Then sign in to the web vault at {site}.",
            ["reset.subject"] = "Reset your KeePort password",
            ["reset.body"] = "Someone asked to reset the password of your KeePort account {username}. Choose a new password with the button below. The link is valid for 30 minutes and works once.",
            ["reset.button"] = "Choose new password",
            ["reset.vault"] = "This changes only your KeePort account password. The master passwords of your vaults stay the same.",
            ["reset.ignore"] = "If you did not ask for it, ignore this e-mail; your password stays unchanged.",
            ["signIn.subject"] = "New sign-in to your KeePort account",
            ["signIn.body"] = "Your account {username} was just signed in to from a browser or device it has not used recently.",
            ["signIn.details"] = "Time: {time}\nBrowser: {device}\nIP address: {ip}",
            ["passwordChangedSelf.subject"] = "Your KeePort password was changed",
            ["passwordChangedSelf.body"] = "The account password of {username} was changed in the account settings.",
            ["passwordChangedAdmin.subject"] = "Your KeePort password was reset",
            ["passwordChangedAdmin.body"] = "An administrator set a new account password for {username}. You were signed out everywhere.",
            ["passwordChangedReset.subject"] = "Your KeePort password was reset",
            ["passwordChangedReset.body"] = "The account password of {username} was reset with a link from an e-mail. You were signed out everywhere.",
            ["emailChanged.subject"] = "Your KeePort e-mail address was changed",
            ["emailChanged.body"] = "The e-mail address of your account {username} was changed to {email}. E-mails from KeePort now go there.",
            ["appPassword.subject"] = "New WebDAV app password for your KeePort account",
            ["appPassword.body"] = "An administrator created the WebDAV app password \"{label}\" for your account {username}. KeePass apps can use it to sync your vaults.",
            ["mfaCode.subject"] = "Your KeePort sign-in code",
            ["mfaCode.body"] = "Enter this code to finish signing in to KeePort. It is valid for 10 minutes and works once.",
            ["mfaCode.notYou"] = "If you are not signing in right now, someone knows your account password. Change it right away and tell your administrator.",
            ["mfaEnabled.subject"] = "Two-factor sign-in was turned on",
            ["mfaEnabled.body"] = "A second factor was added to your account {username}. Signing in now needs a code in addition to your password.",
            ["mfaDisabled.subject"] = "A second factor was removed",
            ["mfaDisabled.body"] = "A second factor was turned off for your account {username}.",
            ["mfaReset.subject"] = "Two-factor sign-in was reset",
            ["mfaReset.body"] = "An administrator turned off two-factor sign-in for your account {username} and signed you out everywhere. You can set it up again in your profile.",
            ["warnFailedSignIns.subject"] = "KeePort: many failed sign-ins",
            ["warnFailedSignIns.body"] = "There were {count} failed sign-ins in the last {minutes} minutes. Check the audit log in the admin console (Logs → Audit log) for names and IP addresses.",
            ["warnCertificate.subject"] = "KeePort: admin certificate expires soon",
            ["warnCertificate.body"] = "The self-signed certificate of the admin console expires on {date} ({days} days). Delete the files in /data/tls and restart the container to create a new one.",
            ["warnStorage.subject"] = "KeePort: your data may not be backed up",
            ["warnStorage.body"] = "KeePort keeps its data in a Docker volume or inside the container, not in a folder on the host. NAS backup tools do not include it. See Admin console → Settings → Data storage.",
            ["warnDiskSpace.subject"] = "KeePort: low disk space",
            ["warnDiskSpace.body"] = "Only {free} of {total} are free where KeePort keeps its data. When the disk is full, KeePort refuses to save vaults."
        },
        ["de"] = new()
        {
            ["greeting"] = "Hallo {username},",
            ["greetingAdmin"] = "Hallo,",
            ["footer"] = "Diese E-Mail wurde von KeePort ({site}) verschickt. Bitte antworte nicht darauf.",
            [NotYou] = "Wenn das nicht du warst, ändere sofort dein Konto-Passwort und sag deinem Administrator Bescheid.",
            ["test.subject"] = "KeePort-Test-E-Mail",
            ["test.body"] = "Das ist eine Test-E-Mail von KeePort. Wenn du sie lesen kannst, funktioniert der E-Mail-Versand.",
            ["verify.subject"] = "Dein KeePort-Bestätigungscode",
            ["verify.body"] = "Gib diesen Code in KeePort ein, um deine E-Mail-Adresse zu bestätigen. Er gilt 30 Minuten.",
            ["verify.ignore"] = "Wenn du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.",
            ["invite.subject"] = "Du wurdest zu KeePort eingeladen",
            ["invite.body"] = "{inviter} hat für dich ein KeePort-Konto mit dem Benutzernamen {username} angelegt. Wähle über den Button unten dein Passwort. Der Link gilt 48 Stunden und funktioniert einmal.",
            ["invite.button"] = "Passwort wählen",
            ["invite.after"] = "Danach meldest du dich im Web-Tresor unter {site} an.",
            ["reset.subject"] = "Setze dein KeePort-Passwort zurück",
            ["reset.body"] = "Jemand möchte das Passwort deines KeePort-Kontos {username} zurücksetzen. Wähle über den Button unten ein neues Passwort. Der Link gilt 30 Minuten und funktioniert einmal.",
            ["reset.button"] = "Neues Passwort wählen",
            ["reset.vault"] = "Dabei ändert sich nur dein KeePort-Konto-Passwort. Die Master-Passwörter deiner Tresore bleiben gleich.",
            ["reset.ignore"] = "Wenn du das nicht angefordert hast, ignoriere diese E-Mail; dein Passwort bleibt unverändert.",
            ["signIn.subject"] = "Neue Anmeldung an deinem KeePort-Konto",
            ["signIn.body"] = "Dein Konto {username} wurde gerade von einem Browser oder Gerät angemeldet, das es in letzter Zeit nicht benutzt hat.",
            ["signIn.details"] = "Zeit: {time}\nBrowser: {device}\nIP-Adresse: {ip}",
            ["passwordChangedSelf.subject"] = "Dein KeePort-Passwort wurde geändert",
            ["passwordChangedSelf.body"] = "Das Konto-Passwort von {username} wurde in den Kontoeinstellungen geändert.",
            ["passwordChangedAdmin.subject"] = "Dein KeePort-Passwort wurde zurückgesetzt",
            ["passwordChangedAdmin.body"] = "Ein Administrator hat für {username} ein neues Konto-Passwort gesetzt. Du wurdest überall abgemeldet.",
            ["passwordChangedReset.subject"] = "Dein KeePort-Passwort wurde zurückgesetzt",
            ["passwordChangedReset.body"] = "Das Konto-Passwort von {username} wurde über einen Link aus einer E-Mail zurückgesetzt. Du wurdest überall abgemeldet.",
            ["emailChanged.subject"] = "Deine KeePort-E-Mail-Adresse wurde geändert",
            ["emailChanged.body"] = "Die E-Mail-Adresse deines Kontos {username} wurde in {email} geändert. E-Mails von KeePort gehen jetzt dorthin.",
            ["appPassword.subject"] = "Neues WebDAV-App-Passwort für dein KeePort-Konto",
            ["appPassword.body"] = "Ein Administrator hat für dein Konto {username} das WebDAV-App-Passwort „{label}“ angelegt. KeePass-Apps können damit deine Tresore synchronisieren.",
            ["mfaCode.subject"] = "Dein KeePort-Anmeldecode",
            ["mfaCode.body"] = "Gib diesen Code ein, um die Anmeldung bei KeePort abzuschließen. Er gilt 10 Minuten und nur einmal.",
            ["mfaCode.notYou"] = "Wenn du dich gerade nicht anmeldest, kennt jemand dein Konto-Passwort. Ändere es sofort und sag deinem Administrator Bescheid.",
            ["mfaEnabled.subject"] = "Zwei-Faktor-Anmeldung wurde eingeschaltet",
            ["mfaEnabled.body"] = "Für dein Konto {username} wurde ein zweiter Faktor eingerichtet. Zur Anmeldung brauchst du jetzt zusätzlich zum Passwort einen Code.",
            ["mfaDisabled.subject"] = "Ein zweiter Faktor wurde entfernt",
            ["mfaDisabled.body"] = "Für dein Konto {username} wurde ein zweiter Faktor ausgeschaltet.",
            ["mfaReset.subject"] = "Zwei-Faktor-Anmeldung wurde zurückgesetzt",
            ["mfaReset.body"] = "Ein Administrator hat die Zwei-Faktor-Anmeldung für dein Konto {username} ausgeschaltet und dich überall abgemeldet. Du kannst sie in deinem Profil neu einrichten.",
            ["warnFailedSignIns.subject"] = "KeePort: viele fehlgeschlagene Anmeldungen",
            ["warnFailedSignIns.body"] = "In den letzten {minutes} Minuten gab es {count} fehlgeschlagene Anmeldungen. Namen und IP-Adressen findest du im Audit-Log der Admin-Konsole (Logs → Audit-Log).",
            ["warnCertificate.subject"] = "KeePort: Admin-Zertifikat läuft bald ab",
            ["warnCertificate.body"] = "Das selbstsignierte Zertifikat der Admin-Konsole läuft am {date} ab (in {days} Tagen). Lösche die Dateien in /data/tls und starte den Container neu, damit ein neues erzeugt wird.",
            ["warnStorage.subject"] = "KeePort: deine Daten werden womöglich nicht gesichert",
            ["warnStorage.body"] = "KeePort speichert seine Daten in einem Docker-Volume oder im Container, nicht in einem Ordner auf dem Host. NAS-Backup-Werkzeuge erfassen sie nicht. Siehe Admin-Konsole → Einstellungen → Datenablage.",
            ["warnDiskSpace.subject"] = "KeePort: wenig Speicherplatz",
            ["warnDiskSpace.body"] = "Dort, wo KeePort seine Daten speichert, sind nur noch {free} von {total} frei. Ist die Platte voll, lehnt KeePort das Speichern von Tresoren ab."
        },
        ["fr"] = new()
        {
            ["greeting"] = "Bonjour {username},",
            ["greetingAdmin"] = "Bonjour,",
            ["footer"] = "Cet e-mail a été envoyé par KeePort ({site}). Merci de ne pas y répondre.",
            [NotYou] = "Si ce n’était pas vous, changez immédiatement le mot de passe de votre compte et prévenez votre administrateur.",
            ["test.subject"] = "E-mail de test KeePort",
            ["test.body"] = "Ceci est un e-mail de test de KeePort. Si vous pouvez le lire, l’envoi d’e-mails fonctionne.",
            ["verify.subject"] = "Votre code de vérification KeePort",
            ["verify.body"] = "Saisissez ce code dans KeePort pour confirmer votre adresse e-mail. Il est valable 30 minutes.",
            ["verify.ignore"] = "Si vous ne l’avez pas demandé, vous pouvez ignorer cet e-mail.",
            ["invite.subject"] = "Vous êtes invité à KeePort",
            ["invite.body"] = "{inviter} a créé pour vous un compte KeePort avec le nom d’utilisateur {username}. Choisissez votre mot de passe avec le bouton ci-dessous. Le lien est valable 48 heures et ne fonctionne qu’une fois.",
            ["invite.button"] = "Choisir le mot de passe",
            ["invite.after"] = "Connectez-vous ensuite au coffre-fort web sur {site}.",
            ["reset.subject"] = "Réinitialisez votre mot de passe KeePort",
            ["reset.body"] = "Quelqu’un a demandé la réinitialisation du mot de passe de votre compte KeePort {username}. Choisissez un nouveau mot de passe avec le bouton ci-dessous. Le lien est valable 30 minutes et ne fonctionne qu’une fois.",
            ["reset.button"] = "Choisir un nouveau mot de passe",
            ["reset.vault"] = "Seul le mot de passe de votre compte KeePort change. Les mots de passe maîtres de vos coffres-forts restent les mêmes.",
            ["reset.ignore"] = "Si vous ne l’avez pas demandé, ignorez cet e-mail ; votre mot de passe reste inchangé.",
            ["signIn.subject"] = "Nouvelle connexion à votre compte KeePort",
            ["signIn.body"] = "Votre compte {username} vient d’être connecté depuis un navigateur ou un appareil qu’il n’a pas utilisé récemment.",
            ["signIn.details"] = "Heure : {time}\nNavigateur : {device}\nAdresse IP : {ip}",
            ["passwordChangedSelf.subject"] = "Votre mot de passe KeePort a été modifié",
            ["passwordChangedSelf.body"] = "Le mot de passe du compte {username} a été modifié dans les paramètres du compte.",
            ["passwordChangedAdmin.subject"] = "Votre mot de passe KeePort a été réinitialisé",
            ["passwordChangedAdmin.body"] = "Un administrateur a défini un nouveau mot de passe pour {username}. Vous avez été déconnecté partout.",
            ["passwordChangedReset.subject"] = "Votre mot de passe KeePort a été réinitialisé",
            ["passwordChangedReset.body"] = "Le mot de passe du compte {username} a été réinitialisé avec un lien reçu par e-mail. Vous avez été déconnecté partout.",
            ["emailChanged.subject"] = "Votre adresse e-mail KeePort a été modifiée",
            ["emailChanged.body"] = "L’adresse e-mail de votre compte {username} a été changée en {email}. Les e-mails de KeePort y sont désormais envoyés.",
            ["appPassword.subject"] = "Nouveau mot de passe d’application WebDAV pour votre compte KeePort",
            ["appPassword.body"] = "Un administrateur a créé le mot de passe d’application WebDAV « {label} » pour votre compte {username}. Les applications KeePass peuvent l’utiliser pour synchroniser vos coffres-forts.",
            ["mfaCode.subject"] = "Votre code de connexion KeePort",
            ["mfaCode.body"] = "Saisissez ce code pour terminer la connexion à KeePort. Il est valable 10 minutes et ne fonctionne qu’une fois.",
            ["mfaCode.notYou"] = "Si vous n’êtes pas en train de vous connecter, quelqu’un connaît le mot de passe de votre compte. Changez-le immédiatement et prévenez votre administrateur.",
            ["mfaEnabled.subject"] = "La connexion à deux facteurs a été activée",
            ["mfaEnabled.body"] = "Un second facteur a été ajouté à votre compte {username}. La connexion demande désormais un code en plus de votre mot de passe.",
            ["mfaDisabled.subject"] = "Un second facteur a été supprimé",
            ["mfaDisabled.body"] = "Un second facteur a été désactivé pour votre compte {username}.",
            ["mfaReset.subject"] = "La connexion à deux facteurs a été réinitialisée",
            ["mfaReset.body"] = "Un administrateur a désactivé la connexion à deux facteurs de votre compte {username} et vous a déconnecté partout. Vous pouvez la configurer à nouveau dans votre profil.",
            ["warnFailedSignIns.subject"] = "KeePort : nombreuses connexions échouées",
            ["warnFailedSignIns.body"] = "Il y a eu {count} connexions échouées au cours des {minutes} dernières minutes. Les noms et adresses IP figurent dans le journal d’audit de la console d’administration (Journaux → Journal d’audit).",
            ["warnCertificate.subject"] = "KeePort : le certificat d’administration expire bientôt",
            ["warnCertificate.body"] = "Le certificat autosigné de la console d’administration expire le {date} (dans {days} jours). Supprimez les fichiers de /data/tls et redémarrez le conteneur pour en créer un nouveau.",
            ["warnStorage.subject"] = "KeePort : vos données ne sont peut-être pas sauvegardées",
            ["warnStorage.body"] = "KeePort conserve ses données dans un volume Docker ou dans le conteneur, et non dans un dossier de l’hôte. Les outils de sauvegarde du NAS ne les incluent pas. Voir Console d’administration → Paramètres → Stockage des données.",
            ["warnDiskSpace.subject"] = "KeePort : espace disque faible",
            ["warnDiskSpace.body"] = "Il ne reste que {free} libres sur {total} à l’emplacement des données de KeePort. Lorsque le disque est plein, KeePort refuse d’enregistrer les coffres-forts."
        }
    };

    /// <summary>
    /// Renders one e-mail in a language. Parameters are filled in as given; "username" selects the personal greeting,
    /// "url" adds a button, "code" a highlighted code.
    /// </summary>
    /// <param name="kind">One of <see cref="Kinds"/>.</param>
    /// <param name="language">de, en or fr; anything else gives English.</param>
    /// <param name="site">The web vault address, shown in the footer.</param>
    /// <param name="values">Placeholder values.</param>
    public static RenderedEmail Render(string kind, string? language, string site, IReadOnlyDictionary<string, string> values)
    {
        var lang = language is "de" or "fr" ? language : "en";
        var parts = new List<(string Text, bool Pre)>();
        var greeting = values.ContainsKey("username") && !kind.StartsWith("warn", StringComparison.Ordinal) ? "greeting" : "greetingAdmin";

        parts.Add((Fill(T(lang, greeting), values), false));
        foreach (var key in BodyKeys(kind))
        {
            parts.Add((Fill(T(lang, key), values), key == "signIn.details"));
        }

        var text = new StringBuilder();
        var html = new StringBuilder();
        html.Append("<!doctype html><html><body style=\"margin:0;padding:24px;background:#f5f3ff;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f1b2e\">");
        html.Append("<table role=\"presentation\" width=\"100%\" style=\"max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e9e5f5\"><tr><td style=\"padding:20px 28px;border-bottom:1px solid #e9e5f5\">");
        html.Append("<span style=\"display:inline-block;padding:6px 10px;border-radius:8px;background:linear-gradient(135deg,#8b5cf6,#d946ef);color:#fff;font-weight:600\">KeePort</span></td></tr><tr><td style=\"padding:24px 28px;font-size:15px;line-height:1.55\">");

        for (var i = 0; i < parts.Count; i++)
        {
            text.Append(parts[i].Text).Append("\n\n");
            var encoded = WebUtility.HtmlEncode(parts[i].Text).Replace("\n", "<br>", StringComparison.Ordinal);
            html.Append("<p style=\"margin:0 0 14px\">").Append(encoded).Append("</p>");
            if (i == 1 && values.TryGetValue("code", out var code))
            {
                text.Append(code).Append("\n\n");
                html.Append("<p style=\"margin:6px 0 18px;font-size:28px;font-weight:700;letter-spacing:6px;font-family:Consolas,Menlo,monospace\">")
                    .Append(WebUtility.HtmlEncode(code)).Append("</p>");
            }
            if (i == 1 && values.TryGetValue("url", out var url))
            {
                text.Append(url).Append("\n\n");
                html.Append("<p style=\"margin:8px 0 18px\"><a href=\"").Append(WebUtility.HtmlEncode(url))
                    .Append("\" style=\"display:inline-block;padding:10px 18px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600\">")
                    .Append(WebUtility.HtmlEncode(T(lang, kind + ".button"))).Append("</a></p>");
            }
        }

        var footer = Fill(T(lang, "footer"), new Dictionary<string, string> { ["site"] = site });
        text.Append("-- \n").Append(footer).Append('\n');
        html.Append("</td></tr><tr><td style=\"padding:14px 28px;border-top:1px solid #e9e5f5;font-size:12px;color:#6b6480\">")
            .Append(WebUtility.HtmlEncode(footer)).Append("</td></tr></table></body></html>");
        return new RenderedEmail(Fill(T(lang, kind + ".subject"), values), text.ToString(), html.ToString());
    }

    /// <summary>Lists the paragraph keys of a template after the greeting, in order.</summary>
    /// <param name="kind">The template name.</param>
    private static IEnumerable<string> BodyKeys(string kind) => kind switch
    {
        Kinds.Verify => ["verify.body", "verify.ignore"],
        Kinds.Invite => ["invite.body", "invite.after"],
        Kinds.Reset => ["reset.body", "reset.vault", "reset.ignore"],
        Kinds.SignIn => ["signIn.body", "signIn.details", NotYou],
        Kinds.PasswordChangedSelf or Kinds.PasswordChangedAdmin or Kinds.PasswordChangedReset => [kind + ".body", NotYou],
        Kinds.EmailChanged => ["emailChanged.body", NotYou],
        Kinds.AppPassword => ["appPassword.body", NotYou],
        Kinds.MfaCode => ["mfaCode.body", "mfaCode.notYou"],
        Kinds.MfaEnabled or Kinds.MfaDisabled or Kinds.MfaReset => [kind + ".body", NotYou],
        _ => [kind + ".body"]
    };

    /// <summary>Looks up a text in a language, falling back to English.</summary>
    /// <param name="language">The language.</param>
    /// <param name="key">The text key.</param>
    private static string T(string language, string key)
        => Texts[language].TryGetValue(key, out var text) ? text : Texts["en"].TryGetValue(key, out var english) ? english : key;

    /// <summary>Fills {placeholders}; unknown placeholders stay visible.</summary>
    /// <param name="text">The text.</param>
    /// <param name="values">The values.</param>
    private static string Fill(string text, IReadOnlyDictionary<string, string> values)
    {
        foreach (var (name, value) in values)
        {
            text = text.Replace("{" + name + "}", value, StringComparison.Ordinal);
        }
        return text;
    }

    /// <summary>
    /// Formats a time for an e-mail as "2026-11-26 14:05 UTC". The container runs without culture data (Alpine,
    /// invariant globalization), so a language-neutral format is used for every language.
    /// </summary>
    /// <param name="time">The time.</param>
    public static string FormatTime(DateTimeOffset time)
        => time.UtcDateTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " UTC";
}
