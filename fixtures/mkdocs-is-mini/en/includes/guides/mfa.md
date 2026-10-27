# Add MFA

This guide adds MFA in {{ product_name }}.

{% if product_name == "WSO2 Identity Platform" %}
## Cloud prerequisites

Sign in to the Console at `{{ console_path }}`.
{% else %}
## Server prerequisites

Start the server first.
{% endif %}

1. Open the [prerequisites](#cloud-prerequisites) or the [install guide]({{base_path}}/deploy/install/).
2. Enable MFA{% if product_name == "WSO2 Identity Server" and is_version > "7.2.0" %} with passkeys{% endif %}.

    ![MFA screen]({{base_path}}/assets/img/mfa.png)

```bash
{% if product_name == "WSO2 Identity Server" %}
curl https://localhost:9443/api/mfa
{% else %}
curl https://api.asgardeo.io/t/bifrost/api/mfa
{% endif %}
```
