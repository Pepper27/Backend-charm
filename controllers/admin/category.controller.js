const Category = require("../../models/category.model")
const categoryHelper = require("../../helper/category.helper")
const AccountAdmin = require("../../models/accountAdmin.model")
const moment = require("moment")
const slugify = require("slugify")
module.exports.createPost = async (req, res) => {
    try {
        const { name, desc } = req.body;
        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Tên danh mục là bắt buộc!"
            });
        }
        const existName = await Category.findOne({
            name: name,
            deleted: false
        });
        if (existName) {
            return res.status(400).json({
                success: false,
                message: "Tên thể loại đã tồn tại!"
            });
        }
        let avatar = req.file ? req.file.path : undefined;
        let position = req.body.position;
        if (!position) {
            const positionCurrent = await Category.countDocuments({ deleted: false });
            position = positionCurrent + 1;
        }
        const description = desc || req.body.description || "";
        const createdBy = req.account?.id;
        const updatedBy = req.account?.id;
        const newCategory = new Category({
            ...req.body,
            name,
            description,
            avatar,
            position,
            createdBy,
            updatedBy
        });
        await newCategory.save();
        return res.status(201).json({
            success: true,
            message: "Tạo danh mục thành công!",
            data: newCategory
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Lỗi server",
            error: error.message
        });
    }
};
module.exports.getCategories = async (req, res) => {
    try {
        const page = req.query.page ? parseInt(req.query.page) : null;
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        const keyword = req.query.keyword || "";
        const find = { deleted: false };
        if (keyword) {
            const slugKeyword = slugify(keyword, {
                lower: true,
                strict: true
            });
            find.slug = { $regex: slugKeyword, $options: "i" };
        }
        let categoryList;
        let categoryTotal;
        if (!page && !limit) {
            // Trả về toàn bộ danh mục nếu không truyền page/limit
            categoryList = await Category.find(find).sort({ position: 1 }).lean();
            categoryTotal = categoryList.length;
        } else {
            const safePage = page || 1;
            const safeLimit = limit || 1000;
            const skip = (safePage - 1) * safeLimit;
            categoryList = await Category.find(find)
                .sort({ position: 1 })
                .skip(skip)
                .limit(safeLimit)
                .lean();
            categoryTotal = await Category.countDocuments({ deleted: false });
        }
        for (const item of categoryList) {
            if (item.createdBy) {
                const createdByName = await AccountAdmin.findOne({
                    _id: item.createdBy
                });
                item.createdByName = createdByName?.fullName;
            }
            if (item.updatedBy) {
                const updatedByName = await AccountAdmin.findOne({
                    _id: item.updatedBy
                });
                item.updatedByName = updatedByName?.fullName;
            }
            item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
            item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");
        }
        return res.status(200).json({
            data: categoryList,
            total: categoryTotal,
            currentPage: page || 1,
            totalPage: limit ? Math.ceil(categoryTotal / limit) : 1
        });
    } catch (error) {
        return res.status(500).json({
            message: "Lỗi",
            error: error.message
        });
    }
};
module.exports.getCategoryById = async (req, res) => {
    try {
        const id = req.params.id
        const categoryCurrent = await Category.findOne({
            _id: id,
            deleted: false
        });
        return res.status(200).json({
            data: categoryCurrent
        });

    } catch (error) {
        return res.status(500).json({
            message: "Lỗi",
            error: error.message
        });
    }
};
module.exports.updateCategoryById = async (req, res) => {
    try {
        const id = req.params.id;
        const old = await Category.findOne({ _id: id, deleted: false });
        if (!old) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy danh mục!"
            });
        }
        // Check trùng tên (không tính chính nó)
        if (req.body.name) {
            const existName = await Category.findOne({
                name: req.body.name,
                _id: { $ne: id },
                deleted: false
            });
            if (existName) {
                return res.status(400).json({
                    success: false,
                    message: "Tên thể loại đã tồn tại!"
                });
            }
        }
        let avatar = old.avatar;
        if (req.file) {
            avatar = req.file.path;
        }
        const updateData = {
            ...req.body,
            avatar,
            updatedBy: req.account?.id,
            updatedAt: Date.now()
        };
        await Category.updateOne({
            _id: id,
            deleted: false
        }, updateData);
        return res.status(200).json({
            success: true,
            message: "Cập nhật danh mục thành công!"
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Lỗi server",
            error: error.message
        });
    }
};

// Xóa mềm danh mục
module.exports.deleteCategoryById = async (req, res) => {
    try {
        const id = req.params.id;
        const old = await Category.findOne({ _id: id, deleted: false });
        if (!old) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy danh mục!"
            });
        }
        await Category.updateOne({ _id: id, deleted: false }, {
            deleted: true,
            deletedAt: Date.now(),
            deletedBy: req.account?.id
        });
        return res.status(200).json({
            success: true,
            message: "Xóa danh mục thành công!"
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Lỗi server",
            error: error.message
        });
    }
};
// module.exports.list = async (req,res) =>{
//     const id = req.query.id
//     const startDate = req.query.startdate
//     const endDate = req.query.enddate
//     const dateFilter = {}
//     const keyword = req.query.keyword
//     const find = {
//         deleted:false,
//     }
//     if(id){
//         find.createdBy = id
//     }
//     if(startDate){
//         dateFilter.$gte = moment(startDate).startOf("date").toDate()
//     }
//     if(endDate){
//         dateFilter.$lte = moment(endDate).endOf("date").toDate()
//     }
//     if(Object.keys(dateFilter).length>0){
//         find.createdAt = dateFilter
//     }
//     if(keyword){
//         const slug= slugify(keyword, {
//             lower:true
//         })
//         const keywordRegex =  new RegExp(slug,"i")
//         find.slug = keywordRegex 
//     }
//     const limnit = 4
//     let page =1
//     if(req.query.page>0){
//         page = req.query.page
//     }
//     const skip = (page -1)*limnit
//     const totalCategory = await Category.countDocuments(find)
//     const pagination ={
//         totalPage:Math.ceil(totalCategory/limnit),
//         totalCategory:totalCategory,
//         skip:skip
//     }
//     const categoryList = await Category
//     .find(find).
//     sort({
//         position:"desc"
//     }).
//     limit(limnit).
//     skip(skip)


//     for (const item of categoryList) {
//         if(item.createdBy){
//             const createdByName = await AccountAdmin.findOne({
//                 _id: item.createdBy
//             })
//             item.createdByName = createdByName.fullName
//         }
//         if(item.updatedBy){
//             const updatedByName = await AccountAdmin.findOne({
//                 _id: item.updatedBy
//             })
//             item.updatedByName = updatedByName.fullName
//         }
//         item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY")
//         item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY")
//     };

//     const accountList = await AccountAdmin.find({
//     }).select("id fullName")
    
//     res.render("admin/pages/category-list",{
//         pageTitle:"Quản lý danh mục",
//         categoryList: categoryList,
//         accountList: accountList,
//         pagination:pagination
//     })
// }
module.exports.getCategoriesParent = async (req,res) =>{
    try {
        const arrayCategory = await Category.find({
            deleted:false
        })

        const categoryTree = categoryHelper.categoryTree(arrayCategory,"")
        return res.status(200).json({
            data: categoryTree
        });
    } catch (error) {
        return res.status(500).json({
            message: "Lỗi khi lấy danh sách danh mục",
            error: error.message
        });
   }   
}
// module.exports.listPatch = async (req,res) =>{
//     try {
//         const ids = req.body.ids
//         await Category.updateMany({
//             _id :{$in:ids}
//         },{
//             deleted:true,
//             deletedAt:Date.now(),
//             deletedBy:req.account.id
//         })
//         req.flash("success","Xóa danh mục thành công!")
//         res.json({
//             code:"success"
//         })
//     } catch (error) {
//         res.json({
//             code:"error",
//             message:"Xóa danh mục thất bại!"
//         })
//     }
// }


// module.exports.edit = async (req,res) =>{
//     try{
//     const categoryList = await Category.find({
//         deleted:false
//     })
//     const categoryTree = categoryHelper.categoryTree(categoryList)
//     const categoryCurrent = await Category.findOne({
//         _id:req.params.id,
//         deleted:false
//     })
//     res.render("admin/pages/category-edit",{
//         pageTitle:"Tạo danh mục",
//         categoryList: categoryTree,
//         categoryCurrent:categoryCurrent
//     })
//     } catch (error) {
//         res.redirect(`/${pathAdmin}/category/list`)
//     }
// }

// module.exports.editPatch = async (req,res) =>{
//    try{
//     const id = req.params.id
//     if(req.body.position){
//         req.body.position = parseInt(req.body.position)
//     }
//     else{
//         const totalPosition = await Category.countDocuments({})
//         req.body.position = totalPosition + 1
//     }
//     req.body.updatedBy = req.account.id
//     if(req.file){
//         req.body.avatar = req.file.path
//     } else{
//         delete req.body.avatar
//     }
//     await Category.updateOne({
//         _id:id,
//         deleted:false
//     }, req.body)
//     req.flash("success", "Chỉnh sửa danh mục thành công!");
//     res.json({
//         code:"success",
//     })
//    }catch(error){
//     res.json({
//         code:"error",
//         message:"Id không hợp lệ"
//     })
//    }
// }