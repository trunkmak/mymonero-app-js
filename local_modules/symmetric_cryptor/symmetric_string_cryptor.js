//
//
// This module implements the RNCryptor version 3 scheme.
//
var crypto = require('crypto');
//
var currentVersionCryptorFormatVersion = 3;
var cryptor_settings = 
{
    algorithm: 'aes256',
    options: 1, // this gets inserted into the format. should probably be renamed to something more concretely descriptive
    salt_length: 8,
    iv_length: 16,
    pbkdf2: 
    {
        iterations: 10000,
        key_length: 32
    },
    hmac: 
    {
        includes_header: true,
        algorithm: 'sha256',
        length: 32
    }
}
//
//
// Encryption
//
function EncryptedBase64String(plaintext_msg, password)
{
    Buffer.isBuffer(plaintext_msg) || (plaintext_msg = new Buffer(plaintext_msg, 'utf8')); // we're expecting a string, but might as well check anyway

    var components = 
    {
        headers: 
        {
            version: String.fromCharCode(currentVersionCryptorFormatVersion),
            options: String.fromCharCode(cryptor_settings.options)
        }
    };
    components.headers.encryption_salt = _new_random_salt();
    components.headers.hmac_salt = _new_random_salt();
    components.headers.iv = _new_random_iv_of_length(cryptor_settings.iv_length);

    var encryption_key = _new_calculated_pbkdf2_key(password, components.headers.encryption_salt);
    var hmac_key = _new_calculated_pbkdf2_key(password, components.headers.hmac_salt);
    var iv = components.headers.iv;
        
    Buffer.isBuffer(iv) || (iv = new Buffer(iv, 'binary'));
    Buffer.isBuffer(encryption_key) || (encryption_key = new Buffer(encryption_key, 'binary'));
    
    var cipher = crypto.createCipheriv(cryptor_settings.algorithm, encryption_key, iv); 
    var encrypted_cipherText = cipher.update(plaintext_msg, 'binary', 'binary') + cipher.final('binary');
    
    components.cipher_text = encrypted_cipherText;

    var binary_data = '';
    binary_data += components.headers.version;
    binary_data += components.headers.options;
    binary_data += components.headers.encryption_salt ? components.headers.encryption_salt : '';
    binary_data += components.headers.hmac_salt ? components.headers.hmac_salt : '';
    binary_data += components.headers.iv;
    binary_data += components.cipher_text;

    var hmac = _new_generated_hmac(components, hmac_key);
    var encryptedMessage_binaryBuffer = new Buffer(binary_data + hmac, 'binary');
    var encryptedMessage_base64String = encryptedMessage_binaryBuffer.toString('base64');
        
    return encryptedMessage_base64String;
};    
module.exports.EncryptedBase64String = EncryptedBase64String;
//
//
// Decryption
//
function DecryptedPlaintextString(encrypted_msg_base64_string, password)
{
    var unpacked_base64_components = _new_encrypted_base64_unpacked_components_object(encrypted_msg_base64_string);
    if (!_is_hmac_valid(unpacked_base64_components, password)) {
        var err = "HMAC is not valid.";

        throw err;
        return undefined;
    }
    var cipherKey_binaryBuffer = new Buffer(_new_calculated_pbkdf2_key(password, unpacked_base64_components.headers.encryption_salt), 'binary');
    var iv_binaryBuffer = new Buffer(unpacked_base64_components.headers.iv, 'binary');
    var cipherText_binaryBuffer = new Buffer(unpacked_base64_components.cipher_text, 'binary');
    var deCipher = crypto.createDecipheriv(cryptor_settings.algorithm, cipherKey_binaryBuffer, iv_binaryBuffer);
    var decrypted = deCipher.update(cipherText_binaryBuffer, 'binary', 'utf8') + deCipher.final('utf8');
    
    return decrypted;
}
module.exports.DecryptedPlaintextString = DecryptedPlaintextString;
//
//
// Shared
//
function _new_encrypted_base64_unpacked_components_object(b64str) 
{
    var binary_data = new Buffer(b64str, 'base64').toString('binary');    
    var components = 
    {
        headers: _new_parsed_headers_object(binary_data),
        hmac: binary_data.substr(-cryptor_settings.hmac.length)
    };
    var header_length = components.headers.length;
    var cipher_text_length = binary_data.length - header_length - components.hmac.length;
    components.cipher_text = binary_data.substr(header_length, cipher_text_length);

    return components;
}
function _new_parsed_headers_object(bin_data) 
{
    var offset = 0;

    var version_char = bin_data[0];
    offset += version_char.length;

    validate_schema_version(version_char.charCodeAt());

    var options_char = bin_data[1];
    offset += options_char.length;

    var encryption_salt = bin_data.substr(offset, cryptor_settings.salt_length);
    offset += encryption_salt.length;

    var hmac_salt = bin_data.substr(offset, cryptor_settings.salt_length);
    offset += hmac_salt.length;

    var iv = bin_data.substr(offset, cryptor_settings.iv_length);
    offset += iv.length;

    var parsing_description = 
    {
        version: version_char,
        options: options_char,
        encryption_salt: encryption_salt,
        hmac_salt: hmac_salt,
        iv: iv,
        length: offset
    };

    return parsing_description;
}
function validate_schema_version(version)
{
    if (version !== currentVersionCryptorFormatVersion) {
        var err = "Unsupported schema version " + version;
        
        throw err;
    }
}
function _is_hmac_valid(components, password)
{
    var hmac_key = _new_calculated_pbkdf2_key(password, components.headers.hmac_salt);
    var generated_hmac = _new_generated_hmac(components, hmac_key);
    var isValid = (components.hmac === generated_hmac);

    return isValid;
}

function _new_calculated_pbkdf2_key(password, salt) 
{ // Apply pseudo-random function HMAC-SHA1 by default
    var key = crypto.pbkdf2Sync(password, salt, cryptor_settings.pbkdf2.iterations, cryptor_settings.pbkdf2.key_length);
    
    return key;
}
function _new_generated_hmac(components, hmac_key)
{
    var hmac_message = '';
    if (cryptor_settings.hmac.includes_header) {
        hmac_message += components.headers.version;
        hmac_message += components.headers.options;
        hmac_message += components.headers.encryption_salt ? components.headers.encryption_salt.toString('binary') : '';
        hmac_message += components.headers.hmac_salt ? components.headers.hmac_salt.toString('binary') : '';
        hmac_message += components.headers.iv.toString('binary');
    }
    hmac_message += components.cipher_text.toString('binary');
    
    var hmac_itself = crypto.createHmac(cryptor_settings.hmac.algorithm, hmac_key).update(hmac_message).digest('binary');
    
    return hmac_itself;
}
function _new_random_salt() 
{
    return _new_random_iv_of_length(cryptor_settings.salt_length);
}
function _new_random_iv_of_length(block_size) 
{
    try {
        var ivBuffer = crypto.randomBytes(block_size);    
        var ivString = ivBuffer.toString('binary', 0, block_size);

        return ivString;
    } catch (ex) {
        // TODO: handle error
        // most likely, entropy sources are drained
		throw ex
    }
}