// disable all of linting
// because this file is a deprecated legacy of Crowi

/* eslint-disable */

module.exports = function(crowi, app) {
  const debug = require('debug')('growi:routes:login');
  const logger = require('@alias/logger')('growi:routes:login');
  const path = require('path');
  const async = require('async');
  const mailer = crowi.getMailer();
  const User = crowi.model('User');
  const { configManager, appService, aclService } = crowi;
  const trustedRedirectHostList = configManager.getConfig('crowi', 'security:trustedRedirectHostList');

  const actions = {};

  const loginSuccess = function(req, res, userData) {
    req.user = req.session.user = userData;

    // update lastLoginAt
    userData.updateLastLoginAt(new Date(), (err, uData) => {
      if (err) {
        logger.error(`updateLastLoginAt dumps error: ${err}`);
      }
    });

    if (!userData.password) {
      return res.redirect('/me/password');
    }

    const jumpTo = req.session.jumpTo;
    if (jumpTo) {
      req.session.jumpTo = null;

      // prevention from open redirect
      try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');

        const redirectUrl = new URL(jumpTo, `${protocol}://${host}`);
        if (redirectUrl.hostname === req.hostname || trustedRedirectHostList.includes(redirectUrl.hostname)) {
          return res.redirect(redirectUrl);
        }
        logger.warn('Requested redirect URL is invalid, redirect to root page');
      }
      catch (err) {
        logger.warn('Requested redirect URL is invalid, redirect to root page', err);
        return res.redirect('/');
      }
    }

    return res.redirect('/');
  };

  const loginFailure = function(req, res) {
    req.flash('warningMessage', 'Sign in failure.');
    return res.redirect('/login');
  };

  actions.error = function(req, res) {
    const reason = req.params.reason;


    let reasonMessage = '';
    if (reason === 'suspended') {
      reasonMessage = 'This account is suspended.';
    }
    else if (reason === 'registered') {
      reasonMessage = 'Wait for approved by administrators.';
    }

    return res.render('login/error', {
      reason,
      reasonMessage,
    });
  };

  actions.login = function(req, res) {
    const loginForm = req.body.loginForm;

    if (req.method == 'POST' && req.form.isValid) {
      const username = loginForm.username;
      const password = loginForm.password;

      // find user
      User.findUserByUsernameOrEmail(username, password, (err, user) => {
        if (err) { return loginFailure(req, res) }
        // check existence and password
        if (!user || !user.isPasswordValid(password)) {
          return loginFailure(req, res);
        }
        return loginSuccess(req, res, user);
      });
    }
    else { // method GET
      if (req.form) {
        debug(req.form.errors);
      }
      return res.render('login', {
      });
    }
  };

  actions.register = function(req, res) {
    if (req.user != null) {
      return res.redirect('/');
    }

    // config で closed ならさよなら
    if (configManager.getConfig('crowi', 'security:registrationMode') == aclService.labels.SECURITY_REGISTRATION_MODE_CLOSED) {
      return res.redirect('/');
    }

    if (req.method == 'POST' && req.form.isValid) {
      const registerForm = req.form.registerForm || {};

      const name = registerForm.name;
      const username = registerForm.username;
      const email = registerForm.email;
      const password = registerForm.password;

      // email と username の unique チェックする
      User.isRegisterable(email, username, (isRegisterable, errOn) => {
        let isError = false;
        if (!User.isEmailValid(email)) {
          isError = true;
          req.flash('registerWarningMessage', 'This email address could not be used. (Make sure the allowed email address)');
        }
        if (!isRegisterable) {
          if (!errOn.username) {
            isError = true;
            req.flash('registerWarningMessage', 'This User ID is not available.');
          }
          if (!errOn.email) {
            isError = true;
            req.flash('registerWarningMessage', 'This email address is already registered.');
          }
        }
        if (isError) {
          debug('isError user register error', errOn);
          return res.redirect('/register');
        }

        User.createUserByEmailAndPassword(name, username, email, password, undefined, (err, userData) => {
          if (err) {
            if (err.name === 'UserUpperLimitException') {
              req.flash('registerWarningMessage', 'Can not register more than the maximum number of users.');
            }
            else {
              req.flash('registerWarningMessage', 'Failed to register.');
            }
            return res.redirect('/register');
          }


          // 作成後、承認が必要なモードなら、管理者に通知する
          const appTitle = appService.getAppTitle();
          if (configManager.getConfig('crowi', 'security:registrationMode') === aclService.labels.SECURITY_REGISTRATION_MODE_RESTRICTED) {
            // TODO send mail
            User.findAdmins((err, admins) => {
              async.each(
                admins,
                (adminUser, next) => {
                  mailer.send({
                    to: adminUser.email,
                    subject: `[${appTitle}:admin] A New User Created and Waiting for Activation`,
                    template: path.join(crowi.localeDir, 'en-US/admin/userWaitingActivation.txt'),
                    vars: {
                      createdUser: userData,
                      adminUser,
                      url: appService.getSiteUrl(),
                      appTitle,
                    },
                  },
                  (err, s) => {
                    debug('completed to send email: ', err, s);
                    next();
                  });
                },
                (err) => {
                  debug('Sending invitation email completed.', err);
                },
              );
            });
          }


          // add a flash message to inform the user that processing was successful -- 2017.09.23 Yuki Takei
          // cz. loginSuccess method doesn't work on it's own when using passport
          //      because `req.login()` prepared by passport is not called.
          req.flash('successMessage', `The user '${userData.username}' is successfully created.`);

          return loginSuccess(req, res, userData);
        });
      });
    }
    else { // method GET of form is not valid
      debug('session is', req.session);
      const isRegistering = true;
      return res.render('login', { isRegistering });
    }
  };

  actions.invited = async function(req, res) {
    if (!req.user) {
      return res.redirect('/login');
    }

    if (req.method == 'POST' && req.form.isValid) {
      const user = req.user;
      const invitedForm = req.form.invitedForm || {};
      const username = invitedForm.username;
      const name = invitedForm.name;
      const password = invitedForm.password;

      // check user upper limit
      const isUserCountExceedsUpperLimit = await User.isUserCountExceedsUpperLimit();
      if (isUserCountExceedsUpperLimit) {
        req.flash('warningMessage', 'ユーザーが上限に達したためアクティベートできません。');
        return res.redirect('/invited');
      }

      const creatable = await User.isRegisterableUsername(username);
      if (creatable) {
        try {
          await user.activateInvitedUser(username, name, password);
          return res.redirect('/');
        }
        catch (err) {
          req.flash('warningMessage', 'アクティベートに失敗しました。');
          return res.render('invited');
        }
      }
      else {
        req.flash('warningMessage', '利用できないユーザーIDです。');
        debug('username', username);
        return res.render('invited');
      }
    }
    else {
      return res.render('invited', {
      });
    }
  };

  actions.updateInvitedUser = function(req, res) {
    return res.redirect('/');
  };

  return actions;
};
