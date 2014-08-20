
// read variables
appStorage = new Backbone.LocalStorage('App');
if (!appStorage.find({id: 'variables'})) {

	defaults = {
		id: 'variables',
		lang: 'fa',
		position: {mode: 'quran', quran: {page: 1, sura: 1, aya: ''}, tafsir: {section: '1_1-5'}}
	};

	appStorage.update(defaults);

	// detect user language
	$.get('http://zolal.herokuapp.com/language', function(language) {
		defaults['lang'] = language;
		appStorage.update(defaults);
		track('Default Language', {'lang': language});
	});
}

variables = appStorage.find({id: 'variables'});

var tafsirDb = {
	id: 'tafsirs',
	migrations:[
		{
			version: 1,
			migrate: function (transaction, next) {
				transaction.db.createObjectStore('tafsirs');
				next();
			}
		}, {
			version: 2,
			migrate: function (transaction, next) {
				next();
			}
		}, {
			version: 3,
			migrate: function (transaction, next) {
				next();
			}
		}, {
			version: 4,
			migrate: function (transaction, next) {
				transaction.objectStore('tafsirs').clear();
				next();
			}
		}, {
			version: 5,
			migrate: function (transaction, next) {
				localStorage.clear();
				next();
			}
		}
	]
};


// models
var Aya = Backbone.Model.extend({
	insertDetail: function(detail) {
		details = this.get('details');
		if (!details) {
			details = {};
			this.set('details', details);
		}

		key = detail['html'].substr(0, 15);
		if (!details[key])
			details[key] = detail;
	},
	localStorage: new Backbone.LocalStorage('Quran')
});

var Quran = Backbone.Collection.extend({
	model: Aya,
	localStorage: new Backbone.LocalStorage('Quran'),
	loadPage: function(page, callback) {
		var collection = this;
		ayas = quran_pages[page];
		(new Aya({id: ayas[0]})).fetch({
			success: function() {
				for (a in ayas) {
					aya = new Aya({id: ayas[a]});
					aya.fetch();
					collection.add(aya);
				}
				if (callback) callback(page);
			},
			error: function () {
				$.ajax({
					context: {page: page},
					url: server +'quran/p'+ page,
					success: function(data){
						_.each(data.split('\n'), function(item) {
							if (item) {
								item = $.parseJSON(item);
								aya = new Aya(item);
								aya.save();
								collection.add(aya);
							}
						});
						if (callback) callback(this.page);
					},
					error: app.connectionError
				});
			}
		});
	}
});

var Bayan = Backbone.Model.extend({
	database: tafsirDb,
	storeName: 'tafsirs'
});
// trigger migrations
(new Bayan({id: '0'})).fetch();


var Almizan = Backbone.Collection.extend({
	database: tafsirDb,
	storeName: 'tafsirs',
	model: Bayan,
	initialize: function() {
		this.loaded = [];
		this.lastFetched = null;
	},
	loadBayan: function(id, callback) {
		if (this.lastFetched && this.lastFetched.get('id') == id) {
			callback(this.lastFetched);
			return;
		}

		// load ayas for inserting details after bayan load
		parts = sectionToAddress(id.split('/')[1])
		startPage = quran_ayas[parts[0] +'_'+ parts[1]];
		endPage = quran_ayas[parts[0] +'_'+ parts[2]];
		this.quran.loadPage(startPage);
		if (startPage != endPage)
			this.quran.loadPage(endPage);

		var almizan = this;
		var bayan = new Bayan({id: id});
		bayan.fetch({
			success: function (bayan) {
				almizan.extractDetails(bayan);
				almizan.lastFetched = bayan;
				if (callback) callback(bayan);
			},
			error: $.proxy(function (bayan) {
				$.ajax({
					context: {id: bayan.get('id')},
					url: server +'almizan_'+ bayan.get('id'),
					success: function(item){
						bayan = new Bayan({id: this.id, content: item});
						bayan.save();
						almizan.extractDetails(bayan);
						if (callback) callback(bayan);
					},
					error: app.connectionError
				});
			})
		});
	},
	extractDetails: function(bayan) {
		var id = bayan.get('id');
		if (this.loaded.indexOf(id) < 0)
			this.loaded.push(id);

		var lang = id.split('/')[0];
		var quran = this.quran;

		$(bayan.get('content')).find('em[rel]').each(function() {
			parts = $(this).attr('rel').split('_'); key = parts[1] +'_'+ parts[2];
			aya = quran.get(key); if (!aya) return;
			index = $(this).parent().index(); if (!index) index = $(this).parent().parent().index()
			aya.insertDetail({type: 'phrase', lang: lang, html: '<p>'+ $(this).parent().html() +'</p>', link: 'almizan_'+ id +'/i'+ index, words: parts[3]});
		});

		var parts = sectionToAddress(id.split('/')[1]);
		$(bayan.get('content')).find('.title').each(function() {
			// todo: smart aya detection
			html = $(this).html().trim();
			if (html[0] == '(' && html[html.length-1] == ')')
				html = html.substr(1, html.length-2);
			html = '<h3>'+ refine(html) +'<h3>';
			for (i = parts[1]; i <= parts[2]; i++) {
				aya = quran.get(parts[0] +'_'+ i); if (!aya) continue;
				aya.insertDetail({type: 'title', lang: lang, html: html, link: 'almizan_'+ id +'/i'+ $(this).parent().index()});
			}
		});
	}
});

// views
var AyaView = Backbone.View.extend({
	template: _.template('<span class="aya-text" rel="<%= sura %>_<%= aya %>"><span class="text"><%= html %></span> <span class="number"><%= number %></span> </span>'),
	render: function () {
		data = this.model.toJSON();
		data['number'] = refine(data['aya']);
		data['html'] = this.html();
		this.setElement(this.template(data));
		return this;
	},
	events: {
		'click': 'click'
	},
	annotate: function(start, end, tag) {
		if (!this.annotations)
			this.annotations = [];
		this.annotations.push({'start': start-1, 'end': end-1, 'tag': tag})
		this.$el.find('.text').html(this.html());
	},
	html: function() {
		words = this.model.get('text').replace(/[ ]*([ۖۗۚۛۙۘ])[ ]*/g, '\$1 ').split(' ');

		if (this.annotations)
			_.each(this.annotations, function(annotation) {
				words[annotation.start] = '<span class="'+ annotation.tag +'">'+ words[annotation.start];
				words[annotation.end] += '</span>';
			});

		return words.join(' ').replace(/([ۖۗۚۛۙۘ])(<\/span>)?/g, '\$2<span class="mark">\$1</span>');
	},
	click: function() {
		aya = this.model.get('sura') +'_'+ this.model.get('aya');
		if (app.position.mode == 'quran') {
			if (this.$el.hasClass('active'))
				app.router.navigate('detail/'+ aya, {trigger: true});
			else
				app.router.navigate('quran/'+ aya, {trigger: true, replace: true});
		}
	}
});

var QuranView = Backbone.View.extend({
	el: $("#quran"),
	initialize: function() {
		this.collection = new Quran();

		// page indicator
		this.pageElement = new Draggabilly($('#page')[0], {axis: 'y', containment: true})
			.on('dragMove', function(instance) {
				instance.element.setAttribute('rel', refine(offsetToPage(instance.position.y)));
			}).on('dragEnd', function(instance) {
				app.router.navigate('quran/p'+ rerefine(instance.element.getAttribute('rel')), {trigger: true});
			});
	},
	render: function() {
		this.loadPage(this.position.page);

		// update address
		if (this.position.aya == '')
			this.position.sura = Number(quran_pages[this.position.page][0].split('_')[0]);

		// prepare pages
		this.loadPage(this.position.page-1);
		this.loadPage(this.position.page+1);

		// show page
		this.$el.find('#page-style').html('#quran .page {width: '+ this.$el.outerWidth() +'px}');
		var quran = this;
		el = this.$el.find('.page[rel='+ this.position.page +']');
		pages = this.$el.find('#pages');
		front = pages.find('.front');
		el.addClass('front');
		if (front.attr('rel') != this.position.page)
			this.$el.stop().animate({scrollLeft: el.offset().left - pages.offset().left + parseInt(this.$el.css('padding-left'))}, (front.length ? 300 : 0), function() {
				front.removeClass('front');
				quran.$el.find('.page[rel='+ quran.position.page +']').addClass('front');
			});

		// page indicator
		indicator = this.$el.find('#page').attr('rel', refine(this.position.page));
		indicator.css('top', pageToOffset(this.position.page));
	},
	renderPage: function(page) {
		var el = this.$el.find('.page[rel='+ page +'] .ayas');
		el.parent().removeClass('loading');
		_.each(this.collection.models, function (item) {
			if (item.get('page') == page) {
				var ayaView = new AyaView({model: item});
				if (item.get('aya') == 1) {
					el.append('<div class="sura header"><div class="right">سورة</div><div class="left">'+ quran_suras[item.get('sura')-1] +'</div></div>');
					if (item.get('sura') != 1 && item.get('sura') != 9)
						el.append('<div class="aya-text bism"><span class="text">بِسمِ اللَّهِ الرَّحمٰنِ الرَّحيمِ</span></div>');
				}
				el.append(ayaView.render().el);
			}
		});
		this.updateSelectedAya();
	},
	loadPage: function(page) {
		if (page > 604 || page < 1)
			return;

		// show loaded page
		if (this.isRendered(page)) {
			this.updateSelectedAya();
			return;
		}

		// add new page
		pages = this.$el.find('#pages');
		newPage = $('<div class="page loading" rel="'+ page +'"><div class="ayas"></div></div>');
		if (this.isRendered(page + 1)) {
			pages.append(newPage);
		} else if (this.isRendered(page - 1)) {
			first = pages.children().first();
			off = first.offset().left;
			pages.prepend(newPage);
			this.$el.scrollLeft(this.$el.scrollLeft() + first.offset().left - off);
		} else {
			pages.empty();
			pages.append(newPage);
		}

		this.collection.loadPage(page, $.proxy(this.renderPage, this));
	},
	updateSelectedAya: function() {
		active = this.$el.find('.active');
		page = this.$el.find('.front');

		if (this.position.aya != '') {
			// don't update it
			pos = this.position; last = this.lastPosition;
			if (last && pos.sura == last.sura && pos.aya == last.aya)
				return;

			id = this.position.sura +'_'+ this.position.aya;
			aya = this.collection.get(id);
			active.removeClass('active');
			elm = this.$el.find('.aya-text[rel='+ id +']').addClass('active');

			// scroll page to top or bottom
			if (elm.position().top < 0)
				page.scrollTop(0);
			else if (elm.position().top + elm.height() > page.height())
				page.scrollTop(page.height());
		} else {
			active.removeClass('active');
			page.scrollTop(0);
		}

		this.lastPosition = $.extend({}, this.position);
	},
	isRendered: function(page) {
		return this.$el.find('.page[rel='+ page +']').length > 0;
	}
});

var TafsirView = Backbone.View.extend({
	el: $("#tafsir"),
	initialize: function() {
		this.content = this.$el.find('.content');
		this.sections = almizan_sections;
		this.parts = [];

		this.steady = new Steady({
			conditions: {'min-top': 0, 'min-bottom': 0},
			scrollElement: this.el,
			throttle: 100,
			handler: function (values, done) {
				app.tafsir.checkScroll(values.bottom < 300, values.top < 300);
				done();
			}
		});
	},
	render: function() {
		this.$el.find('.content').empty();
		this.trigger('updateAddress');
		this.loadSection();
	},
	renderBayan: function (bayan) {
		content = $(bayan.get('content')).filter(function() { return this.nodeType != 3; });
		content.find('span.footnote').tooltip({html: true, placement: 'auto', trigger: 'click hover focus'});
		this.parts = content.toArray();
		this.$el.removeClass('loading');
		this.content.html('');
		this.$el.scrollTop(0);

		// bold active part
		if (this.position.aya)
			part = content.find('code.aya[rel='+ this.position.aya +']').parent().index();
		else if (this.position.part)
			part = this.position.part;
		else
			part = 0;
		this.currentPart = part >= 0 && part < this.parts.length ? part : 0;

		if (this.currentPart > 0)
			$(this.parts[this.currentPart]).addClass('active');

		this.checkScroll(true, true);
	},
	loadSection: function() {
		var tafsir = this;
		var position = this.position;
		var prepare = Boolean(this['prepare']);

		if (prepare) {
			position = quranToTafsir(this['prepare'].quran);
			bid = position.lang +'/'+ position.section;
			if (this.almizan.loaded.indexOf(bid) >= 0)
				return;
		}

		// show loading element
		if (!prepare)
			this.$el.addClass('loading');

		this.almizan.loadBayan(position.lang +'/'+ position.section, prepare ? null : $.proxy(this.renderBayan, this));
	},
	checkScroll: function (loadBottom, loadTop) {
		loadParts = 10;

		if (loadBottom)
			this.content.append(this.parts.splice(this.currentPart, loadParts));

		if (loadTop) {
			this.currentPart -= loadParts;
			if (this.currentPart < 0) {
				loadParts += this.currentPart;
				this.currentPart = 0;
			}

			contentHeight =	this.content.height();
			this.content.prepend(this.parts.splice(this.currentPart, loadParts));
			this.$el.scrollTop(this.$el.scrollTop() + this.content.height() - contentHeight);
		}

		// find current page
		var current_page;
		base = this.$el.position().top;
		this.$el.find('code.page').each(function() {
			if ($(this).position().top > base) {
				current_page = $(this).attr('rel');
				return false;
			}
		})
		if (current_page) {
			parts = current_page.split(',');
			this.trigger('tafsir-scroll', {'volume': parts[0], 'page': parts[1]})
		}

		// remvoe active footnotes
		this.$el.find('.tooltip').remove();
	}
});

var AddressView = Backbone.View.extend({
	el: $("#header"),
	initialize: function() {
		var sura_select = this.$el.find('#sura');

		// sura selector
		var suraTokens = function(name) {
			name = normalize(name);

			if (name[0] == '‌')
				name = name.substr(1);

			tokens = name.split('‌');
			tokens.push(name);
			tokens.push('‌'); // general token
			if (name.substr(0, 2) == 'ال')
				tokens.push(name.substr(2));
			return tokens;
		}
		sura_items = new Bloodhound({
			local: _.map(quran_suras, function(item, i) { return {name: item, id: i+1}; }),
			datumTokenizer: function(d) { return suraTokens(d.name); },
			queryTokenizer: suraTokens,
			limit: 1000
		});
		sura_items.initialize();
		sura_select.typeahead({hint: false, autoselect: true, minLength: 0}, {
			name: 'sura',
			displayKey: 'name',
			source: sura_items.ttAdapter()
		});

		// selector events
		sura_select.bind('typeahead:selected', function(t, selected, name) {
			if (name == 'sura') {
				id = selected.id;
				if (id > 0 && id != app.position.quran.sura)
					app.router.navigate('quran/'+ id +'_1', {trigger: true});
				sura_select.blur();
			}
		});
		sura_select.bind('typeahead:closed', function() {
			app.address.render();
		});

		// search input
		var search_input = this.$el.find('#search');
		var ayaTokens = function(text) {
			text = normalize(text.trim());
			return text.split(' ');
		}

		this.aya_items = new Bloodhound({
			local: [],
			datumTokenizer: function(d) { return ayaTokens(d.raw); },
			queryTokenizer: ayaTokens,
			limit: 20
		});

		search_input.typeahead({hint: false, autoselect: true, minLength: 3}, {
			name: 'aya',
			displayKey: 'raw',
			source: this.aya_items.ttAdapter(),
			templates: {
				suggestion: function(aya) {
					parts = aya.id.split('_');
					result = searchResult(aya.raw, ayaTokens(aya.raw), ayaTokens(search_input.val()));
					return '<p>'+ result +'</p>'; // '<i>'+ quran_suras[parts[0]-1] +'، '+ parts[1] +'</i>';
				}
			}
		});

		search_input.bind('typeahead:selected', function(t, selected, name) {
			if (name == 'aya') {
				id = selected.id;
				app.router.navigate('quran/'+ id, {trigger: true});
			}
		});
		search_input.bind('typeahead:closed', function() {
			app.address.render();
		});
	},
	events: {
		'click .glyphicon': 'controlClick',
		'click .quran #sura': 'suraSelect',
	},
	render: function() {
		// clone position
		position = $.extend(true, {}, this.position);
		if (position.mode == 'quran') {
			page_sura = Number(quran_pages[position.quran.page][0].split('_')[0]);
			this.$el.find('#sura').val(quran_suras[page_sura-1]);
		} else if (position.mode == 'detail') {
			this.$el.find('.detail .left').text(refine(position.detail.aya) +' سوره '+ quran_suras[position.detail.sura-1]);
		} else if (position.mode == 'tafsir') {
			this.$el.find('.tafsir .left').text('المیزان');
		}

		this.$el.find('.front').removeClass('front');
		this.$el.find('.'+ position.mode).addClass('front');

		// set page title
		title = '';
		if (position.mode == 'quran') {
			if (position.quran.aya != '')
				title = 'آیه '+ refine(position.quran.aya) + ' سوره '+ quran_suras[position.quran.sura-1];
			else
				title = 'صفحه '+ refine(position.quran.page);
		} else if (position.mode == 'detail') {
			title = 'توضیح آیه '+ refine(position.detail.aya) + ' سوره '+ quran_suras[position.detail.sura-1];
		} else if (position.mode == 'tafsir') {
			parts = sectionToAddress(position.tafsir.section);
			title = 'تفسیر سوره '+ quran_suras[parts[0]-1] +'، آیات '+ refine(String(parts[1])) +' تا '+ refine(String(parts[2]));
		}
		$(document).attr('title', title +' - زلال');

		// store position
		variables.position = this.position;
		appStorage.update(variables);

		// metrics
		position = this.position;
		if (position.mode == 'quran') {
			if (! position.quran.aya)
				track('Quran', position.quran);
		} else if (position.mode == 'detail')
			track('Detail', {aya: position.detail.sura +'_'+ position.detail.aya});
		else if (position.mode == 'tafsir')
			track('Almizan', position.tafsir);
	},
	controlClick: function(e) {
		this.trigger($(e.target).attr('rel'));
	},
	suraSelect: function() {
		this.$el.find('#sura').val(' ').trigger('input').val('‌').trigger('input').focus();
	},
	tafsirScroll: function(args) {
		if (args['volume'] && args['page'])
			this.$el.find('.tafsir .left').text('المیزان، ج'+ refine(args['volume']) +' ص'+ refine(args['page']));
	},
	showSearch: function() {
		this.$el.find('.front').removeClass('front');
		this.$el.find('.search').addClass('front');
		this.$el.find('#search').val('').focus();
		if (this.aya_items.local.length)
			return;

		// init source
		var address = this;
		download_quran().then(function() {
			setTimeout(function() { // render address bar
				address.aya_items.local = JSON.parse(localStorage.Raws);
				address.aya_items.initialize();
			}, 20);
		});
	}
});

var AppView = Backbone.View.extend({
	el: $("body"),
	initialize: function() {
		this.address = new AddressView();
		this.quran = new QuranView();
		this.detail = new DetailView();
		this.tafsir = new TafsirView();

		this.tafsir.almizan = new Almizan();
		this.tafsir.almizan.quran = this.quran.collection;

		this.detail.quran = this.quran.collection;
		this.detail.almizan = this.tafsir.almizan;

		this.quran.on('updateAddress', this.address.render, this.address);
		this.tafsir.on('updateAddress', this.address.render, this.address);
		this.tafsir.on('tafsir-scroll', this.address.tafsirScroll, this.address);
		this.address.on('next-page', this.nextQuranPage, this);
		this.address.on('prev-page', this.prevQuranPage, this);
		this.address.on('show-tafsir', this.showTafsir, this);
		this.address.on('show-quran', this.showQuran, this);
		this.address.on('menu', this.showMenu, this);
		this.address.on('search', this.address.showSearch, this.address);
		this.address.on('next-aya', this.nextAyaDetail, this);
		this.address.on('prev-aya', this.prevAyaDetail, this);

		// set position
		this.position = variables.position;
		this.quran.on('updateAddress', this.tafsir.loadSection, $.extend({}, this.tafsir, {prepare: this.position}));
	},
	events: {
		'keydown': 'navKey',
	},
	render: function() {
		this.quran.lastPosition = '';
		this.address.position = this.position;
		this.address.render();

		this.$el.find('#views > .front').removeClass('front');
		this.$el.find('#views > #'+ this.position.mode).addClass('front');

		if (this.position.mode == 'quran') {
			this.quran.position = this.position.quran;
			this.quran.render();
		} else if (this.position.mode == 'detail') {
			this.detail.position = this.position.detail;
			this.detail.render();
		} else if (this.position.mode == 'tafsir') {
			this.tafsir.position = this.position.tafsir;
			this.tafsir.render();
		}
	},
	connectionError: function() {
		var refresh_app = function() {
			$('.loading.failed').removeClass('failed').unbind('click', refresh_app);
			app.render();
		}

		$('.loading').addClass('failed').bind('click', refresh_app);
	},
	showTafsir: function() {
		tafsir = quranToTafsir(this.position.quran);
		this.router.navigate('almizan_'+ tafsir.lang +'/'+ tafsir.aya, {trigger: true});
	},
	showQuran: function() {
		if (this.position.mode == 'detail')
			this.router.navigate('quran/'+ this.position.detail.sura +'_'+ this.position.detail.aya, {trigger: true});
		else if (this.position.mode == 'tafsir') {
			quran = this.position.quran ? this.position.quran : tafsirToQuran(this.position.tafsir);
			if (quran.aya)
				this.router.navigate('quran/'+ quran.sura +'_'+ quran.aya, {trigger: true});
			else
				this.router.navigate('quran/p'+ quran.page, {trigger: true});
		}
	},
	nextQuranPage: function() {
		page = this.position.quran.page;
		page += 1; if (page > 604) page = 604;
		this.router.navigate('quran/p'+ page, {trigger: true, replace: true});
	},
	prevQuranPage: function() {
		page = this.position.quran.page;
		page -= 1; if (page < 1) page = 1;
		this.router.navigate('quran/p'+ page, {trigger: true, replace: true});
	},
	nextQuranAya: function() {
		quran = this.position.quran;
		if (quran.aya == '') {
			first_aya = quran_pages[Number(quran.page)][0].split('_');
			quran.sura = Number(first_aya[0]);
			quran.aya = Number(first_aya[1]);
		}
		this.router.navigate('quran/'+ nextAya(quran.sura, quran.aya), {trigger: true, replace: true});
	},
	prevQuranAya: function() {
		quran = this.position.quran;
		if (quran.aya == '') {
			first_aya = quran_pages[Number(quran.page)][0].split('_');
			quran.sura = Number(first_aya[0]);
			quran.aya = Number(first_aya[1]);
		}
		this.router.navigate('quran/'+ prevAya(quran.sura, quran.aya), {trigger: true, replace: true});
	},
	nextAyaDetail: function() {
		detail = this.position.detail;
		this.router.navigate('detail/'+ nextAya(detail.sura, detail.aya), {trigger: true, replace: true});
	},
	prevAyaDetail: function() {
		detail = this.position.detail;
		this.router.navigate('detail/'+ prevAya(detail.sura, detail.aya), {trigger: true, replace: true});
	},
	showMenu: function() {
		this.$el.find('#menu').modal();
		show_tafsir_stats();
	},
	navKey: function(e) {
		if (e.target.tagName == 'INPUT' || $('.modal').is(':visible'))
			return;

		enter = e.keyCode == 13;
		page_up = e.keyCode == 33;
		page_down = e.keyCode == 34;
		left_arrow = e.keyCode == 37;
		up_arrow = e.keyCode == 38;
		right_arrow = e.keyCode == 39;
		down_arrow = e.keyCode == 40;

		if (this.position.mode == 'quran') {
			if (enter && this.position.quran.aya)
				app.router.navigate('detail/'+ this.position.quran.sura +'_'+ this.position.quran.aya, {trigger: true});
			if(left_arrow)
				this.nextQuranPage();
			else if(right_arrow)
				this.prevQuranPage();
			else if(up_arrow)
				this.prevQuranAya();
			else if(down_arrow)
				this.nextQuranAya();
			else
				return;
		}
		else if (up_arrow || down_arrow || page_up || page_down) {
			if (this.position.mode == 'detail')
				element = this.detail.$el;
			else if (this.position.mode == 'tafsir')
				element = this.tafsir.$el;
			else
				return;

			if (up_arrow)
				element.scrollTop(element.scrollTop() - 30);
			else if (down_arrow)
				element.scrollTop(element.scrollTop() + 30);
			else if (page_up)
				element.scrollTop(element.scrollTop() - element.height());
			else if (page_down)
				element.scrollTop(element.scrollTop() + element.height());
		}
		else if (this.position.mode == 'detail') {
			if(left_arrow)
				this.nextAyaDetail();
			else if(right_arrow)
				this.prevAyaDetail();
			else
				return;
		} else
				return;

		e.preventDefault();
	}
});

var AddressRouter = Backbone.Router.extend({
	routes: {
		'quran/p:page': 'quranPage',
		'quran/:aya': 'quranAya',
		'detail/:aya': 'ayaDetail',
		'almizan_:lang/:aya': 'almizanAya',
		'almizan_:lang/:section/i:index': 'almizanSection',
	},
	quranPage: function(page) {
		if (isNaN(page) || page < 0 || page > 605)
			return;

		app.position.mode = 'quran';
		app.position.quran = {'page': Number(page), 'sura': '', 'aya': ''};
		app.render();
	},
	quranAya: function(aya) {
		if (!(aya in quran_ayas))
			return;

		app.position.mode = 'quran';
		app.position.quran = {'page': quran_ayas[aya], 'sura': Number(aya.split('_')[0]), 'aya': Number(aya.split('_')[1])};
		app.render();
	},
	ayaDetail: function(aya) {
		if (!(aya in quran_ayas))
			return;

		app.position.mode = 'detail';
		app.position.detail = {sura: Number(aya.split('_')[0]), aya: Number(aya.split('_')[1])};
		app.render();
	},
	almizanAya: function(lang, aya) {
		if (!(aya in almizan_ayas))
			return;

		app.position.mode = 'tafsir';
		app.position.tafsir = {lang: lang, section: almizan_ayas[aya], aya: aya};
		app.render();
	},
	almizanSection: function(lang, section, part) {
		if (almizan_sections.indexOf(section) < 0)
			return;

		app.position.mode = 'tafsir';
		app.position.tafsir = {lang: lang, section: section, part: Number(part)};
		app.render();
	}
});

var DetailView = Backbone.View.extend({
	el: $('#detail .content'),
	render: function () {
		this.$el.find('#sections').empty();

		id = this.position.sura +'_'+ this.position.aya;
		this.quran.loadPage(quran_ayas[id], $.proxy(this.renderAya, this));

		// details
		tafsir = quranToTafsir(this.position);
		bid = tafsir.lang +'/'+ tafsir.section;
		if (this.almizan.loaded.indexOf(bid) >= 0)
			this.renderDetails();
		else
			this.almizan.loadBayan(bid, $.proxy(this.renderDetails, this));
	},
	renderAya: function() {
		this.aya = this.quran.get(id);

		// aya
		this.ayaView = new AyaView({model: this.aya});
		this.$el.find('#aya').html(this.ayaView.render().el);

		// translation
		if (variables.lang == 'fa')
			this.$el.find('#translation').text(this.aya.get('fa'));
		else
			this.$el.find('#translation').empty();

		// goto
		goto = this.$el.find('#goto-tafsir');
		goto.html('تفسیر آیه '+ refine(this.position.aya) +' سوره '+ quran_suras[this.position.sura-1]);
		goto.attr('href', '#almizan_'+ variables.lang +'/'+ this.aya.get('id'));
	},
	renderDetails: function() {
		var view = this;
		details = this.aya.get('details');
		if (!details)
			return;

		var words = this.aya.get('text').replace(/ ?[ۖۗۚۛۙۘ]/g, '').split(' ');
		_.each(details, function (detail) {
			if (detail.lang != variables.lang) return;

			phrase = '';
			if (detail.type == 'phrase') {
				start = Number(detail.words.split('-')[0]); end = Number(detail.words.split('-')[1]);
				phrase = '<span class="aya-text fill"><span class="text">'+ words.slice(start-1, end).join(' ') +'</span></span>'
				view.ayaView.annotate(start, end, 'found');
			}

			view.$el.find('#sections').append('<a href="#'+ detail.link +'"><div class="fill">'+ phrase + detail.html +'</div></a>');
		});
	}
});


// helpers
var numchars = {'0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹'};
var refine = function(str) {
	return String(str).replace(/[0-9]/g, function(c) { return numchars[c]; });
};
var renumchars = {'۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'};
var rerefine = function(str) {
	return String(str).replace(/[۰-۹]/g, function(c) { return renumchars[c]; });
};
var normalchars = {'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ة': 'ه', 'ي': 'ی', 'ك': 'ک'};
var normalize = function(str) {
	return String(str).replace(/[أإآؤةيك]/g, function(c) { return normalchars[c]; });
};


var sectionToAddress = function(section) {
	tmp = section.replace('-', '_');
	parts = tmp.split('_');
	if (parts.length == 2)
		parts.push(parts[1]);
	return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
};
var quranToTafsir = function(quran) {
	var aya;
	if (quran.aya == '')
		aya = quran.sura +'_'+ quran_pages[quran.page][0].split('_')[1];
	else
		aya = quran.sura +'_'+ quran.aya;
	return {lang: variables.lang, aya: aya, section: almizan_ayas[aya]};
};
var tafsirToQuran = function(tafsir) {
	if (tafsir.aya)
		parts = tafsir.aya.split('_');
	else
		parts = sectionToAddress(tafsir.section);

	return {sura: parts[0], aya: parts[1]};
};

var nextAya = function(sura, aya) {
	if (aya < sura_ayas[sura])
		aya += 1;
	else if (aya == sura_ayas[sura] && sura < quran_suras.length) {
		sura += 1;
		aya = 1;
	}
	return sura +'_'+ aya;
}
var prevAya = function(sura, aya) {
	if (aya > 1)
		aya -= 1;
	else if (aya == 1 && sura > 1) {
		sura -= 1;
		aya = sura_ayas[sura];
	}
	return sura +'_'+ aya;
}

var offsetToPage = function(offset) {
	height = $('.page').height() - $('#page').height();
	page = Math.round((offset / height) * 604);

	if (page > 604) return 604;
	if (page < 1) return 1;
	return page;
}
var pageToOffset = function(page) {
	height = $('.page').height() - $('#page').height();
	offset = height * (page / 604);
	return offset;
}


// aya inverted index
var quran_ayas = {}, sura_ayas = {}, almizan_ayas = {};
_.each(quran_pages, function(page, p) {
	for (aya in page) {
		quran_ayas[page[aya]] = Number(p);
		sura_ayas[Number(page[aya].split('_')[0])] = Number(page[aya].split('_')[1]);
	}
});
_.each(almizan_sections, function(section) {
	parts = sectionToAddress(section);
	for (i = parts[1]; i <= parts[2]; i++)
		almizan_ayas[parts[0]+'_'+i] = section;
});


// aya search
var searchResult = function(resultText, resultTokens, queryTokens) {
	words = resultText.split(' ');

	// match query and result
	matched = [];
	for (r in resultTokens)
		for (q in queryTokens)
			if (resultTokens[r] == queryTokens[q] || (resultTokens[r].substr(0, queryTokens[q].length) == queryTokens[q])) {
				matched.push(Number(r));
				break;
			}

	// select surrounding words
	selection = []; queue = matched.slice(); chars = 0;
	while(chars < searchResultChars && queue.length) {
		word = queue.shift();
		if (selection.indexOf(word) >= 0)
			continue;

		if (word > 0)
			queue.push(word-1);
		if (word < words.length-1)
			queue.push(word+1);
		selection.push(word);
		chars += words[word].length;
	}

	// bold matched words
	for (m in matched)
		words[matched[m]] = '<b>'+ words[matched[m]] +'</b>';

	// result composition
	result = [];
	selection.sort(function(a, b) { return a - b; });

	var lastW = -1;
	selection.forEach(function(w) {
		if (w != lastW+1)
			result += ' ...';
		result += ' '+ words[w];
		lastW = w;
	});

	if (lastW != selection.length-1)
		result += ' ...';

	return result.trim();
}
